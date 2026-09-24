#!/usr/bin/env python3
"""Raffinement MD3 conservateur, hors ligne. Ne modifie jamais les PK3 sources.

python3 tools/model-pipeline/enhance.py --model models/weapons2/machinegun/machinegun.md3
Les copies de public/generated/models restent experimentales, sans remplacement automatique.
"""
import argparse
import hashlib
import json
import math
import struct
import zipfile
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

def read(data):
    if data[:4] != b'IDP3' or struct.unpack_from('<i', data, 4)[0] != 15:
        raise ValueError('MD3 version 15 attendu')
    frames, tags, count = struct.unpack_from('<3i', data, 76)
    frames_at, tags_at, offset, end = struct.unpack_from('<4i', data, 92)
    if end > len(data) or frames < 1:
        raise ValueError('MD3 tronque')
    surfaces = []
    for _ in range(count):
        nf, ns, nv, nt, ti, sh, uv, xyz, size = struct.unpack_from('<9i', data, offset + 72)
        if nf != frames or offset + size > end or nv > 4096:
            raise ValueError('Surface MD3 incoherente')
        packed = np.frombuffer(data, dtype='<i2', count=nf*nv*4, offset=offset+xyz).reshape(nf,nv,4)
        encoded = packed[:,:,3].astype(np.uint16)
        lat = (encoded >> 8) * (2*math.pi/255)
        lng = (encoded & 255) * (2*math.pi/255)
        normals = np.stack([np.cos(lat)*np.sin(lng), np.sin(lat)*np.sin(lng), np.cos(lng)], axis=-1)
        surfaces.append(dict(header=data[offset:offset+108], shaders=data[offset+sh:offset+sh+ns*68],
            indices=np.frombuffer(data,dtype='<i4',count=nt*3,offset=offset+ti).reshape(-1,3).copy(),
            uv=np.frombuffer(data,dtype='<f4',count=nv*2,offset=offset+uv).reshape(-1,2).copy(),
            positions=packed[:,:,:3].astype(np.float64)/64, normals=normals))
        offset += size
    return dict(header=data[:108], frames=data[frames_at:frames_at+frames*56],
                tags=data[tags_at:tags_at+frames*tags*112], surfaces=surfaces, frame_count=frames)

def refine(surface, strength=0.5, max_displacement=0.125):
    """Midpoints courbes selon les normales ; bords ouverts et coutures UV verrouilles."""
    p, n, uv = surface['positions'], surface['normals'], surface['uv']
    edges = {}
    for triangle in surface['indices']:
        for a,b in zip(triangle, np.roll(triangle,-1)):
            edge = tuple(sorted((int(a),int(b))))
            edges[edge] = edges.get(edge,0)+1
    if p.shape[1] + len(edges) > 4096:
        raise ValueError('Limite MD3 de 4096 sommets depassee : diminuer --levels')
    newp, newn, newuv = [p], [n], [uv]
    mids = {}
    for edge, adjacent in edges.items():
        a,b = edge; mids[edge] = p.shape[1] + len(mids)
        midpoint = (p[:,a] + p[:,b]) / 2
        normal = n[:,a] + n[:,b]
        normal /= np.maximum(np.linalg.norm(normal,axis=-1,keepdims=True),1e-12)
        if adjacent == 2 and np.all(np.sum(n[:,a]*n[:,b],axis=-1) > math.cos(math.radians(45))):
            direction = p[:,b] - p[:,a]
            offset = (np.sum(direction*n[:,b],axis=-1,keepdims=True)*n[:,b]
                     -np.sum(direction*n[:,a],axis=-1,keepdims=True)*n[:,a]) * strength / 8
            length = np.linalg.norm(offset,axis=-1,keepdims=True)
            offset *= np.minimum(1, max_displacement / np.maximum(length,1e-12))
            midpoint += offset
        newp.append(midpoint[:,None,:]); newn.append(normal[:,None,:]); newuv.append(((uv[a]+uv[b])/2)[None,:])
    triangles=[]
    for a,b,c in surface['indices']:
        ab=mids[tuple(sorted((int(a),int(b))))]; bc=mids[tuple(sorted((int(b),int(c))))]; ca=mids[tuple(sorted((int(c),int(a))))]
        triangles.extend([(a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)])
    return dict(surface, positions=np.concatenate(newp,axis=1), normals=np.concatenate(newn,axis=1),
                uv=np.concatenate(newuv), indices=np.asarray(triangles,dtype=np.int32))

def write(model):
    surfaces=[]
    for surface in model['surfaces']:
        p,n=surface['positions'],surface['normals']; nf,nv,_=p.shape
        quantized=np.rint(p*64)
        if np.any(np.abs(quantized)>32767): raise ValueError('Positions hors limites MD3')
        lat=np.rint(np.mod(np.arctan2(n[:,:,1],n[:,:,0]),2*math.pi)*255/(2*math.pi)).astype(np.uint16)
        lng=np.rint(np.arccos(np.clip(n[:,:,2],-1,1))*255/(2*math.pi)).astype(np.uint16)
        packed=np.empty((nf,nv,4),dtype='<i2'); packed[:,:,:3]=quantized
        packed[:,:,3]=((lat<<8)|lng).view(np.int16)
        indices=surface['indices'].astype('<i4').tobytes(); shaders=surface['shaders']; uv=surface['uv'].astype('<f4').tobytes()
        header=bytearray(surface['header']); ti=108; sh=ti+len(indices); atuv=sh+len(shaders); xyz=atuv+len(uv)
        struct.pack_into('<9i',header,72,nf,len(shaders)//68,nv,len(indices)//12,ti,sh,atuv,xyz,xyz+packed.nbytes)
        surfaces.append(bytes(header)+indices+shaders+uv+packed.tobytes())
    frames=bytearray(model['frames'])
    if model['surfaces']:
        p=np.concatenate([s['positions'] for s in model['surfaces']],axis=1)
        for frame in range(model['frame_count']):
            origin=np.array(struct.unpack_from('<3f',frames,frame*56+24))
            struct.pack_into('<6f',frames,frame*56,*(np.min(p[frame],axis=0)-1/64),*(np.max(p[frame],axis=0)+1/64))
            struct.pack_into('<f',frames,frame*56+36,float(np.max(np.linalg.norm(p[frame]-origin,axis=-1)))+1/64)
    header=bytearray(model['header']); tags=model['tags']; fa=108; ta=fa+len(frames); sa=ta+len(tags)
    struct.pack_into('<4i',header,92,fa,ta,sa,sa+sum(map(len,surfaces)))
    return bytes(header)+frames+tags+b''.join(surfaces)

def enhance(data, levels=1, strength=0.5, max_displacement=0.125):
    original=read(data); model=dict(original)
    model['surfaces']=[dict(s) for s in original['surfaces']]
    for _ in range(levels): model['surfaces']=[refine(s,strength,max_displacement) for s in model['surfaces']]
    result=write(model); checked=read(result)
    if checked['tags'] != original['tags'] or checked['frame_count'] != original['frame_count']:
        raise ValueError('Animation ou tags alteres')
    report=dict(sourceSHA256=hashlib.sha256(data).hexdigest(), frames=checked['frame_count'], tagsPreserved=True,
      trianglesBefore=sum(len(s['indices']) for s in original['surfaces']),
      trianglesAfter=sum(len(s['indices']) for s in checked['surfaces']), levels=levels,
      maxAddedVertexDisplacement=max_displacement, strength=strength,
      note='Sommets originaux conserves. Courbure bornee sur les nouvelles aretes internes ; coutures verrouillees.')
    return result,report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',required=True)
    parser.add_argument('--source',default='baseq3',choices=['baseq3','baseoa','missionpack'])
    parser.add_argument('--levels',type=int,choices=[0,1,2],default=1)
    parser.add_argument('--strength',type=float,default=0.5)
    parser.add_argument('--max-displacement',type=float,default=0.125)
    args=parser.parse_args()
    if not 0 <= args.strength <= 1 or not 0 <= args.max_displacement <= 1: parser.error('strength et max-displacement doivent rester entre 0 et 1')
    name=args.model.lower().replace('\\','/')
    if not name.startswith('models/') or '..' in name.split('/') or not name.endswith('.md3'): parser.error('Chemin relatif models/*.md3 attendu')
    data=None
    for archive in sorted((ROOT/'public/data'/args.source).glob('*.pk3')):
        with zipfile.ZipFile(archive) as handle:
            match=next((key for key in handle.namelist() if key.lower()==name),None)
            if match: data=handle.read(match)
    if data is None: parser.error('Modele absent des archives')
    result,report=enhance(data,args.levels,args.strength,args.max_displacement)
    output=ROOT/'public/generated/models'/name
    output.parent.mkdir(parents=True,exist_ok=True); output.write_bytes(result)
    output.with_suffix('.report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(report,output=str(output)),indent=2))

if __name__=='__main__': main()
