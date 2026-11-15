# ORBIS

A tool for exploring lunar landing sites and planning missions around the Moon's south pole.

ORBIS aims to make it easier to explore potential landing locations, compare mission conditions, and work together on lunar mission plans.

## Project Demonstration

[Watch the ORBIS Demo](media/Orbis.mp4)

A 30-second demonstration of ORBIS, developed for the 2026 NASA Space Apps Challenge!

## Getting Started

To run ORBIS locally, you'll need Node.js and Python installed. Run the commands below from the repository root unless a step says otherwise.

**1. Add the scientific data**

The large terrain files and SPICE kernels are not included in Git. Create `data/source/` and `data/kernels/` inside the repository if they do not exist. For a basic run, download the 80 m elevation and hillshade files listed under [Lunar Terrain](#lunar-terrain) into `data/source/`, and all four files listed under [SPICE Kernels](#spice-kernels) into `data/kernels/`. Keep the filenames exactly as shown in those tables. You do not need to create or configure a database; ORBIS creates it when the backend starts.

The PSR file adds the shadow overlay. The 5 m files add finer local terrain and slope measurements where they have coverage. Put any of these additional terrain files in `data/source/` too. The SPICE kernels are required for Sun/Earth calculations.

**2. Start the backend**

```bash
cd backend
python -m venv .venv
```

On Windows, activate the virtual environment:

```powershell
.\.venv\Scripts\Activate.ps1
```

On macOS or Linux, activate it with:

```bash
source .venv/bin/activate
```

Install the dependencies and start the server:

```bash
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

**3. Start the frontend**

Open another terminal from the project root:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

The backend runs at [http://localhost:8000](http://localhost:8000), with API documentation available at [http://localhost:8000/docs](http://localhost:8000/docs).

### First steps in ORBIS

1. Open **Explore → Candidate search**. Choose a search area, arrival time, mission duration, and the longest darkness and Earth outage your mission can tolerate. You can explore the map before creating a project.
2. Run **Search candidate areas**. If a result looks worth keeping, give it a name and select **Create project + candidate site**. You can also use **Create** in the header to start a project directly.
3. Select the saved site in **Browse**. Use **Mission Analysis** to inspect its terrain and changing Sun/Earth visibility, and **Statistics** to see the visibility windows and compare sites. **Explore → Landing windows** can search for favorable arrival dates at a saved site.

## Datasets

ORBIS uses publicly available NASA lunar datasets to explore the Moon's south pole.

Dataset paths are configured in [`data/datasets.json`](data/datasets.json), allowing datasets to be updated or replaced without changing the application code, provided the replacements are compatible with the processing pipeline.

## Features

- Explore the lunar south pole without creating a project first. Choose a search area on the map, an arrival time, and a mission duration.
- Set the longest darkness and Earth-visibility outage your mission can tolerate. Daily Earth contact, minimum candidate area, slope, and roughness are optional filters.
- Compare candidate areas on the map. Green, yellow, and red show how sampled locations compare with your limits.
- If no candidate area meets the limits, compare arrivals 7, 14, and 21 days later.
- For a selected landing site, search 30, 60, or 90 days for favorable arrival times under your darkness and Earth-outage limits. Preview a result in Mission Analysis or save its arrival time and duration to the project.
- Create a project and an initial candidate site from a search result. You can move the site or add more sites afterward.
- Use the map's optional PSR, landmark, elevation-contour, and slope layers to explore terrain context.
- Use Mission Analysis to view terrain, live Sun and Earth readings, and a mission-time slider for a selected site or inspected point.
- Use Statistics to examine visibility windows on a shared timeline, inspect points, and compare landing sites. Resize the workspace panels on desktop; smaller screens use stacked panes and drawers.

Candidate areas are visibility estimates, not confirmed safe landing sites. Sun visibility does not guarantee enough solar power, and Earth visibility does not guarantee a working radio link.

### Featured Lunar Landmarks

ORBIS includes a curated dataset of ten named features near the lunar south pole in [`frontend/public/landmarks.json`](frontend/public/landmarks.json). The entries include official feature-center coordinates, feature types, approximate diameters, and brief educational descriptions. A landmark's named center is **not** a recommended landing location.

Turn on Landmarks beside PSR to see pink outlines for the approximate feature diameters. Clicking a landmark or using the tour arrows moves the map to that feature. Outlines show catalog diameters, not surveyed feature boundaries.

- **Names, coordinates, types, and diameters:** [USGS Gazetteer of Planetary Nomenclature — The Moon](https://planetarynames.wr.usgs.gov/Page/MOON/target). The Gazetteer publishes IAU-approved feature names and lunar coordinate information.
- **Scientific context and imagery:** NASA's [Lunar South Pole Terrain in Coded Color](https://svs.gsfc.nasa.gov/5127), the [Lunar Reconnaissance Orbiter Camera (LROC)](https://lroc.im-ldi.com/), and NASA's [Scientific Visualization Studio](https://svs.gsfc.nasa.gov/).
- **Descriptions:** Short ORBIS-written summaries based on the cited material; they are not verbatim NASA descriptions or official NASA assessments.
- **Images:** Landmark images are served from `frontend/public/landmarks/`. Each entry links to its original media page and records its credit and image subject. The viewer uses `image.url` when set, or the local `image.suggested_filename`; a missing file shows a placeholder.

| Featured landmark | Official feature record | Media / scientific reference |
|---|---|---|
| Shackleton | [USGS](https://planetarynames.wr.usgs.gov/Feature/5450) | [NASA SVS — Visualizing Shackleton](https://svs.gsfc.nasa.gov/4716) |
| de Gerlache | [USGS](https://planetarynames.wr.usgs.gov/Feature/1439) | [LROC — Shackleton–de Gerlache Ridge](https://lroc.im-ldi.com/images/1247) |
| Haworth | [USGS](https://planetarynames.wr.usgs.gov/Feature/14502) | [NASA SVS — LRO/LOLA Lunar South Pole Flyover](https://svs.gsfc.nasa.gov/3686) |
| Shoemaker | [USGS](https://planetarynames.wr.usgs.gov/Feature/5494) | [LROC — Permanently Shadowed Craters](https://lroc.im-ldi.com/images/1255) |
| Faustini | [USGS](https://planetarynames.wr.usgs.gov/Feature/1919) | [LROC — Faustini PSR Atlas](https://lroc.im-ldi.com/atlases/psr/SP_871460_0840750) |
| Cabeus | [USGS](https://planetarynames.wr.usgs.gov/Feature/953) | [NASA Science — Cabeus Crater](https://science.nasa.gov/image-detail/cabeus-crater-lro/) |
| Sverdrup | [USGS](https://planetarynames.wr.usgs.gov/Feature/5782) | [LROC — South Pole Map](https://lroc.im-ldi.com/news/1179) |
| Nobile | [USGS](https://planetarynames.wr.usgs.gov/Feature/4321) | [LROC — Nobile Rim Terrain](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_NOBILE02) |
| Amundsen | [USGS](https://planetarynames.wr.usgs.gov/Feature/247) | [NASA SVS — South Pole Terrain](https://svs.gsfc.nasa.gov/5127) |
| Mons Mouton | [USGS](https://planetarynames.wr.usgs.gov/Feature/16070) | [NASA Science — Mons Mouton](https://science.nasa.gov/resource/mons-mouton-a-newly-named-lunar-mountain/) |

A media page may show a wider region, selected terrain, or a scientific visualization rather than a photograph centered on the named feature. Check each image's subject, credit, and usage terms before adding it to the tour. For reuse, see [NASA's Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). LROC products should retain the credits specified on their source pages (often NASA/GSFC/Arizona State University). NASA imagery and the USGS Gazetteer are independent sources: the latter establishes feature names/positions, not image attribution.

### Lunar Terrain

**South Pole Overview (80°S–90°S)**

| Dataset | File | Source |
|---|---|---|
| Elevation (80 m/pixel) | `LDEM_80S_80MPP_ADJ.tiff` | [Download from NASA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF) |
| Hillshade (80 m/pixel) | `LDEM_80S_80MPP_ADJ_HILL.tiff` | [Download from NASA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ_HILL.TIF) |
| Permanently Shadowed Regions (20 m/pixel) | `LPSR_80S_20MPP_ADJ.tiff` | [Download from NASA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF) |

NASA serves these three files with a `.TIF` extension. Save them in `data/source/` with the `.tiff` filenames shown above, which match `data/datasets.json`.

**High-Resolution South Pole Mosaic (87°S–90°S)**

| Dataset | File | Source |
|---|---|---|
| Elevation (5 m/pixel) | `ldem_87s_5mpp.tif` | [Download](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldem_87s_5mpp.tif) |
| Hillshade (5 m/pixel) | `ldem_87s_5mpp_hillshade.tif` | [Download](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldem_87s_5mpp_hillshade.tif) |
| Slope (5 m/pixel) | `ldsm_87s_5mpp.tif` | [Download](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/87S/ldsm_87s_5mpp.tif) |

The original terrain files are stored in `data/source/`. Large source files and generated data are excluded from Git.

The 5 m mosaic is used for local terrain horizons and slope where covered; the 80 m DEM supplies wider-area terrain data. The map's slope layer combines the 5 m slope raster where available with an 80 m DEM-derived estimate elsewhere.

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

Lunar landmark names and official feature-center coordinates are sourced from the [USGS Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/Page/MOON/target). Additional image and educational references are listed in the [Featured Lunar Landmarks](#featured-lunar-landmarks) section; each image must also retain its individual credit.

### Media Credits

- Music: "Stylz" - Ahjay Stelino (Mixkit)
- Lunar footage: "Digitally Generated Planet" - Crime Lab (Pexels)

Footage and music are used under their respective free-use licenses.

## License

ORBIS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
