import pytest
from pathlib import Path
from orbital.ingestion.fetch import fetch_satellites, CATALOG_PATH, SAMPLE_PATH

def test_offline_loading():
    """
    Ensures that calling fetch_satellites() in default offline mode 
    correctly loads the local JSON catalog without hitting the internet.
    """
    # Verify the local file exists before testing
    if not CATALOG_PATH.exists():
        pytest.skip("Local catalog_30k.json not found. Run fetch.py first to generate it.")
        
    satellites = fetch_satellites(offline=True)
    
    # Assertions to validate data structure
    assert isinstance(satellites, list), "Loaded data must be a list of dictionaries."
    assert len(satellites) > 0, "Satellite catalog cannot be empty."
    
    # Check that standard fields from CelesTrak GP data exist on the first item
    first_sat = satellites[0]
    assert "NORAD_CAT_ID" in first_sat, "Missing NORAD_CAT_ID in satellite record."
    assert "OBJECT_NAME" in first_sat, "Missing OBJECT_NAME in satellite record."

def test_sample_file_exists():
    """Verifies that the developer sample file was generated correctly."""
    assert SAMPLE_PATH.exists(), "Development sample file (sample_dev.json) is missing."