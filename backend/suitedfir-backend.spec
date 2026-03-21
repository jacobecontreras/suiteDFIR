"""
PyInstaller spec file for suiteDFIR Python Backend
Bundles the FastAPI backend and all dependencies into a single executable
"""

import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Backend directory - SPECPATH is provided by PyInstaller for spec files
backend_dir = SPECPATH
src_dir = os.path.join(backend_dir, 'src')

# Data files to include
datas = [
    ('bin', 'bin'),
    ('src', 'src'),  # Include the src directory
    # Note: forensic-tools are copied by build scripts to Resources/, not bundled by PyInstaller
    # Only include the database schema if it exists
    # (os.path.join(backend_dir, 'app.db'), '.'),
]
datas += collect_data_files('google.protobuf')
datas += collect_data_files('grpc')


# Collect hidden imports
hiddenimports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'fastapi',
    'fastapi.dependencies',
    'fastapi.security',
    'fastapi.middleware',
    'fastapi.middleware.cors',
    'fastapi.middleware.gzip',
    'fastapi.responses',
    'pydantic',
    'pydantic.dataclasses',
    'starlette',
    'starlette.responses',
    'starlette.middleware',
    'starlette.middleware.cors',
    'aiofiles',
    'websockets',
    'sqlite3',
    'bs4',
    'lxml',
    'xmltodict',
    'bencoding',
    'blackboxprotobuf',
    'nska_deserialize',
    'biplist',
    'pandas',
    'numpy',
    'astc_decomp_faster',
    'ijson',
    'mmh3',
    'mdplistlib',
    'pillow_heif',
    'Crypto',
    'xlsxwriter',
    'polyline',
    'geopy',
    'fitdecode',
    'simplekml',
    'pgpy',
    'liblzfse',
    'mdplist',
    'folium',
    'imghdr',
    'google',
    'google.protobuf',
    'google.protobuf.descriptor',
]

# Collect all submodules for key forensic packages to ensure they are fully bundled
hiddenimports += collect_submodules('pandas')
hiddenimports += collect_submodules('numpy')
hiddenimports += collect_submodules('PIL')
hiddenimports += collect_submodules('Crypto')
hiddenimports += collect_submodules('simplekml')
hiddenimports += collect_submodules('nska_deserialize')
hiddenimports += collect_submodules('blackboxprotobuf')
hiddenimports += collect_submodules('pgpy')
hiddenimports += collect_submodules('liblzfse')
hiddenimports += collect_submodules('folium')
hiddenimports += collect_submodules('mdplist')
hiddenimports += collect_submodules('google')
hiddenimports += collect_submodules('google.protobuf')

binaries = []
zipfiles = []

# Analysis configuration
a = Analysis(
    [os.path.join(src_dir, 'main.py')],
    pathex=[backend_dir, src_dir],  # Add src_dir to pathex
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
    ],  # Exclude heavy unused libs
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='suitedfir-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # Set to True for Electron to capture port from stdout on Windows
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # You can add an icon file later
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='suiteDFIR Backend',
)
