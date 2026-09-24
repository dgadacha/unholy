"""Inventaire des peaux MD3 et medias de combat des archives locales."""
import struct
import zipfile
from scanner import archives
from shaders import clean_path

EFFECTS = ('rocketExplosion', 'grenadeExplosion', 'bulletExplosion', 'plasmaExplosion',
           'railExplosion', 'bfgExplosion', 'lightningBoltNew', 'railCore', 'railDisc',
           'smokePuff', 'sprites/plasma1', 'gfx/damage/bullet_mrk',
           'gfx/damage/burn_med_mrk', 'gfx/damage/plasma_mrk')

def collect(data, scripts, images):
    files = {}
    for path in archives(data):
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                if name.lower().endswith('.md3') and name.lower().startswith(('models/weapons2/', 'models/weaphits/', 'models/ammo/')):
                    files[name.lower()] = archive.read(name)
    names = set(name.lower() for name in EFFECTS)
    for data in files.values():
        count = struct.unpack_from('<i', data, 84)[0]
        offset = struct.unpack_from('<i', data, 100)[0]
        for _ in range(count):
            shaders = struct.unpack_from('<i', data, offset + 76)[0]
            at = offset + struct.unpack_from('<i', data, offset + 92)[0]
            for i in range(shaders):
                name = data[at+i*68:at+i*68+64].split(b'\0')[0].decode('latin1')
                names.add(clean_path(name))
            offset += struct.unpack_from('<i', data, offset + 104)[0]
    for name in list(names):
        script = scripts.get(name)
        if script:
            names.update(script.dependencies)
    return sorted(name for name in names if name in images or name in scripts)
