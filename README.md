![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white) ![Windows](https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white) ![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black)

> **Beta (v0.1.0)**:
>This project is current in **Beta**, While it leverages industry-standard forensic tools (iLEAPP, aLEAPP, libimobiledevice), it remains a forensic best practice to always independently verify significant findings against raw data and secondary tools.

![suiteDFIR banner](frontend/public/readme-banner.webp)

suiteDFIR is a forensic extraction and analysis suite built for speed, ease-of-use, and privacy.

**Co-developed with**: [Slay3r00](https://github.com/Slay3r00)

## Features
- **Device Extraction**: Extract iOS backups via USB using libimobiledevice. Supports encrypted and unencrypted backups with progress tracking.
- **LEAPP Analysis**: Integrated iLEAPP (iOS) and aLEAPP (Android) forensic parsers for artifact extraction.
- **Timeline Events**: Reconstruct data from multiple sources into a searchable chronological view.
- **Geospatial Viewer**: Automatically extracts KML files from LEAPP reports. Features layer switching (Satellite, Hybrid, Default), custom KML imports, and location search pinning.
- **Settings Management**: Set and store Google Maps API key here in order to access the Geospatial page
- **Private & Local**: All data processing is done on your local machine. Forensic data is never sent to external servers.

## Showcase

#### Dashboard
![Dashboard](./assets/dashboard.png)

#### Backup Extraction
![Backup](./assets/backup.png)

#### Artifact Analysis
![Analysis](./assets/analysis.png)

#### Timeline Events
![Timeline](./assets/timeline.png)

#### Location Mapping
![Map](./assets/map.png)

#### Embedded LEAPP Reports
![Reports](./assets/reports.png)

## Privacy & Data Locality

suiteDFIR is designed to prioritize your privacy and the security of forensic data. Understanding where data stays local and where external connections are made is critical for forensic integrity.

### What Stays Local
- **Forensic Extraction**: All device imaging and backup extractions are performed locally via USB.
- **Artifact Parsing**: The iLEAPP and aLEAPP engines run entirely within your local environment.
- **Case Database**: All investigative data, metadata, and case files are stored on your local disk.
- **Analysis & Timeline**: Data correlation and timeline reconstruction are 100% offline.

### Non-Local Dependencies
While processing is local, certain UI and utility features require an internet connection:
- **Map Page**: Rendering map tiles and layers requires connecting to providers (Google, Carto, OpenStreetMap).
- **Location Search**: Geocoding and searching for addresses is performed via external API calls (e.g., Google Maps API).

## Quick Start
1. **Launch**: Open suiteDFIR on your workstation.
2. **Create Case**: Create a new case and add relevant investigation details.
3. **Connect**: Navigate to the **Backups** page and connect the target device via USB.
4. **Extract**: Start the local extraction to image the device.
5. **Analyze**: Navigate to the **Analysis** page to process the extracted data.
6. **Timeline**: Navigate to the **Timeline** page to view the reconstructed event history.
7. **Map**: Navigate to the **Map** page to visualize geographic data.

## Tech Stack
- **Desktop**: [Electron](https://www.electronjs.org/)
- **Frontend**: [React](https://reactjs.org/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/)
- **Backend**: [Python](https://www.python.org/), [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/)
- **Build**: [PyInstaller](https://pyinstaller.org/), [Vite](https://vitejs.dev/)

## Powered By

suiteDFIR stands on the shoulders of giants. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for full attributions and license texts.

- [iLEAPP](https://github.com/abrignoni/iLEAPP) & [aLEAPP](https://github.com/abrignoni/aLEAPP)
- [libimobiledevice](https://libimobiledevice.org/) (Licensed under LGPL 2.1+)

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](./LICENSE) and [NOTICE](./NOTICE) files for details.

## Development

### Environment Setup
1. **Node.js**: Ensure Node.js 18+ is installed.
2. **Python**: Python 3.9+ is required for the backend forensic engines.
3. **Virtual Environment**: Initialize the Python environment:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

### Installation
Install all dependencies for root, frontend, and electron layers:
```bash
yarn install:all
```

### Local Development
Start the concurrent development environment (Vite + Electron):
```bash
yarn dev:electron
```

### Build Procedures
suiteDFIR uses a multi-stage build process to bundle the Python environment, Vite frontend, and Electron shell.

#### Desktop Application
Build the full production bundle for your current platform:
- **macOS**: `yarn build:mac`
- **Windows**: `yarn build:win`
- **Linux**: `yarn build:linux`

#### Component Builds
- **Backend Only**: `yarn build:backend` (Packages Python via PyInstaller)
- **Frontend Only**: `yarn build:frontend` (Builds static Vite assets)

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](./LICENSE) and [NOTICE](./NOTICE) files for details.

Third-party components are subject to their own licenses. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) for full attributions.
