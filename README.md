# ORBIS

A tool for exploring lunar landing sites and planning missions around the moon's south pole.

ORBIS aims to make it easier to explore potential landing locations, compare mission conditions and work together on lunar mission plans.

## Getting Started

To run ORBIS locally, you'll need Node.js and Python installed.

**1. Start the backend**

```bash
cd backend
python -m venv .venv
```

On Windows, activate the virtual environment:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install the dependencies and start the server:

```bash
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

**2. Start the frontend**

Open another terminal from the project root:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

The backend runs at http://localhost:8000, with API documentation available at http://localhost:8000/docs.

## Datasets

ORBIS uses publicly available NASA lunar datasets to explore the moon's south pole.

Dataset paths are configured in [`data/datasets.json`](data/datasets.json), allowing datasets to be updated or replaced without changing the application code, provided the replacements are compatible with the processing pipeline.

## Features

- Explore the lunar south pole without creating a project first. Choose a search area on the map, an arrival time, and a mission duration.
- Set the longest darkness and Earth-visibility outage your mission can tolerate. Daily Earth contact and minimum candidate area are optional filters.
- Compare candidate areas on the map. Green, yellow, and red show how sampled locations compare with your limits.
- If no candidate area meets the limits, compare arrivals 7, 14, and 21 days later.
- Create a project and an initial candidate site from a search result. You can move the site or add more sites afterward.
- Use Mission Analysis to see Sun and Earth visibility windows and a timeline for a selected site or inspected point.
- Use Statistics to examine a project's search region. Resize the workspace panels on desktop; smaller screens use stacked panes and drawers.

Candidate areas are visibility estimates, not confirmed safe landing sites. Sun visibility does not guarantee enough solar power, and Earth visibility does not guarantee a working radio link.

### Lunar Terrain

**South Pole Overview (80°S–90°S)**

| Dataset | File | Source |
|---|---|---|
| Elevation (80 m/pixel) | `LDEM_80S_80MPP_ADJ.tiff` | [NASA LOLA South Pole](https://pgda.gsfc.nasa.gov/products/90) |
| Hillshade (80 m/pixel) | `LDEM_80S_80MPP_ADJ_HILL.tiff` | [NASA LOLA South Pole](https://pgda.gsfc.nasa.gov/products/90) |
| Permanently Shadowed Regions (20 m/pixel) | `LPSR_80S_20MPP_ADJ.tiff` | [NASA LOLA South Pole](https://pgda.gsfc.nasa.gov/products/90) |

**High-Resolution South Pole Mosaic (87°S–90°S)**

| Dataset | File | Source |
|---|---|---|
| Elevation (5 m/pixel) | `ldem_87s_5mpp.tif` | [Download](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldem_87s_5mpp.tif) |
| Hillshade (5 m/pixel) | `ldem_87s_5mpp_hillshade.tif` | [Download](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldem_87s_5mpp_hillshade.tif) |
| Slope (5 m/pixel) | `ldsm_87s_5mpp.tif` | [Download](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldsm_87s_5mpp.tif) |

The original terrain files are stored in `data/source/`. Large source files and generated data are excluded from Git.

The 5 m mosaic is intended for detailed regional analysis. The application must support and validate the high-resolution datasets before they can be used.

### SPICE Kernels

ORBIS uses NASA/JPL SPICE kernels to calculate the positions of the Sun and Earth relative to lunar landing sites.

Download the following files from NASA's [Navigation and Ancillary Information Facility (NAIF)](https://naif.jpl.nasa.gov/naif/data_generic.html):

| Kernel | Purpose | Download |
|---|---|---|
| `naif0012.tls` | Leap-second information | [Download](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls) |
| `de440s.bsp` | Planetary ephemeris | [Download](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp) |
| `moon_pa_de440_200625.bpc` | Lunar orientation | [Download](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc) |
| `moon_de440_250416.tf` | Lunar reference frames | [Download](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf) |

Place the downloaded files in `data/kernels/`:

```text
data/
└── kernels/
    ├── naif0012.tls
    ├── de440s.bsp
    ├── moon_pa_de440_200625.bpc
    └── moon_de440_250416.tf
```

Keep the original filenames. Ensure `backend/ephemeris.py` references these files.

The kernels are required for the Sun/Earth calculation backend. They are not included in the Git repository and do not require a NASA API key.

### Updating Datasets

To replace a terrain dataset:

1. Download the new dataset into `data/source/`.
2. Update its filename in `data/datasets.json`.
3. Regenerate any processed data if necessary.

Replacement datasets must have compatible coordinate systems, geographic coverage and formats. Changing a filename alone does not guarantee compatibility.

SPICE kernels can also be updated, but their versions and compatibility with the selected lunar reference frame must be verified.

### Attribution

Lunar terrain datasets are provided by NASA's Goddard Space Flight Center through the Planetary Geodesy Data Archive.

- [NASA LOLA South Pole Data Products](https://pgda.gsfc.nasa.gov/products/90)
- [NASA South Pole LOLA DEM Mosaic](https://pgda.gsfc.nasa.gov/products/81)
- Barker et al. (2023), *The Planetary Science Journal*, 4, 183 — [Publication](https://doi.org/10.3847/PSJ/acf3e1)
- Barker et al. (2021), *Planetary and Space Science*, 203, 105119 — [Publication](https://doi.org/10.1016/j.pss.2020.105119)
- [LOLA South Pole Dataset DOI](https://doi.org/10.60903/gsfcpgda-lola-spole)

Astronomical ephemeris and lunar reference-frame data are provided by NASA/JPL's Navigation and Ancillary Information Facility through the SPICE system.

## License

ORBIS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.