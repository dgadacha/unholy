import unittest
import struct
import numpy as np
from enhance import enhance, read, write

class ModelTests(unittest.TestCase):
    def fixture(self):
        header=bytearray(108);header[:4]=b'IDP3';struct.pack_into('<i',header,4,15)
        struct.pack_into('<3i',header,76,2,1,1)
        frames=bytearray(112)
        tags=bytes(range(112))*2
        sh=bytearray(108);sh[:4]=b'IDP3'
        positions=np.array([[[0,0,0],[2,0,0],[2,2,0],[0,2,0]],[[0,0,1],[2,0,1],[2,2,1],[0,2,1]]],dtype=float)
        normals=np.tile([0,0,1],(2,4,1)).astype(float)
        surface=dict(header=sh, shaders=b'test'+bytes(64),positions=positions,normals=normals,
          uv=np.array([[0,0],[1,0],[1,1],[0,1]],dtype=float),indices=np.array([[0,1,2],[0,2,3]]))
        return write(dict(header=header,frames=frames,tags=tags,surfaces=[surface],frame_count=2))
    def test_frames_tags_original_vertices_and_uv(self):
        data=self.fixture();out,report=enhance(data)
        before,after=read(data),read(out)
        self.assertEqual(after['tags'],before['tags'])
        self.assertEqual(after['frame_count'],2)
        a,b=before['surfaces'][0],after['surfaces'][0]
        np.testing.assert_array_equal(a['positions'],b['positions'][:,:4])
        np.testing.assert_array_equal(a['uv'],b['uv'][:4])
        np.testing.assert_allclose(b['positions'][1]-b['positions'][0],np.tile([0,0,1],(9,1)))
        self.assertEqual(report['trianglesAfter'],8)
        self.assertEqual(b['indices'].max(),8)
        np.testing.assert_allclose(np.linalg.norm(b['normals'],axis=-1),1,atol=1e-6)
    def test_reject_corrupt(self):
        with self.assertRaises(ValueError): enhance(bytes(108))

if __name__=='__main__':unittest.main()
