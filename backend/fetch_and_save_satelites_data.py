import json
import os
from spacetrack import SpaceTrackClient

# Authenticate with your free Space-Track credentials
st = SpaceTrackClient(identity="aayushtheupper1@gmail.com", password="hackathon_12345")

target_dir = os.path.join("..", "data")
os.makedirs(target_dir, exist_ok=True)
file_path = os.path.join(target_dir, "space_track_satellites.json")

# Fetch latest active orbital data directly in JSON
data = st.gp(decay_date=None, format="json")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(data)

print(f"Saved Space-Track data to '{file_path}'.")