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

| Dataset | File | Source |
|---|---|---|
| Elevation | `LDEM_80S_80MPP_ADJ.TIF` | [NASA LOLA South Pole](https://pgda.gsfc.nasa.gov/products/90) |
| Hillshade | `LDEM_80S_80MPP_ADJ_HILL.TIF` | [NASA LOLA South Pole](https://pgda.gsfc.nasa.gov/products/90) |
| Permanently Shadowed Regions | `LPSR_80S_20MPP_ADJ.TIF` | [NASA LOLA South Pole](https://pgda.gsfc.nasa.gov/products/90) |

The original dataset files are stored in `data/source/`. Large source files and generated data are excluded from Git.

### Updating Datasets

To replace a dataset:

1. Download the new dataset into `data/source/`.
2. Update its filename in `data/datasets.json`.
3. Regenerate any processed data if necessary.

Replacement datasets must have compatible coordinate systems, geographic coverage and formats. Changing a filename alone does not guarantee compatibility.

### Attribution

Lunar terrain datasets are provided by NASA's Goddard Space Flight Center through the Planetary Geodesy Data Archive.

- [NASA LOLA South Pole Data Products](https://pgda.gsfc.nasa.gov/products/90)
- Barker et al. (2023), *The Planetary Science Journal*, 4, 183.
- [Scientific Publication](https://doi.org/10.3847/PSJ/acf3e1)
- [Dataset DOI](https://doi.org/10.60903/gsfcpgda-lola-spole)

## License

ORBIS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.