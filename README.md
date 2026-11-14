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

## License

ORBIS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.