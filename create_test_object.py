import json
from copy import deepcopy


INPUT_FILE = (
    "orbital/propagation/sample_data/"
    "iss_trajectory.json"
)

OUTPUT_FILE = (
    "orbital/propagation/sample_data/"
    "test_object_trajectory.json"
)


with open(
    INPUT_FILE,
    "r",
    encoding="utf-8",
) as file:
    object_1 = json.load(file)


object_2 = deepcopy(object_1)

object_2["name"] = "TEST OBJECT"
object_2["norad_id"] = 99999


for point in object_2["trajectory"]:
    point["position_km"][0] += 5.0


with open(
    OUTPUT_FILE,
    "w",
    encoding="utf-8",
) as file:
    json.dump(
        object_2,
        file,
        indent=2,
    )


print(
    f"Created {OUTPUT_FILE}"
)