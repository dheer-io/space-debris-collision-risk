from datetime import datetime, timedelta, timezone
from pathlib import Path
import json

from sgp4.api import Satrec, jday


def load_tle(tle_file):
    """
    Read a three-line TLE file.

    Returns:
        tuple:
            name: Satellite name
            line1: TLE line 1
            line2: TLE line 2
    """

    tle_file = Path(tle_file)

    if not tle_file.exists():
        raise FileNotFoundError(
            f"TLE file not found: {tle_file}"
        )

    with tle_file.open("r") as file:
        lines = [line.strip() for line in file if line.strip()]

    if len(lines) != 3:
        raise ValueError(
            f"Expected a 3-line TLE file, found {len(lines)} lines"
        )

    name, line1, line2 = lines

    if not line1.startswith("1 "):
        raise ValueError(
            "Invalid TLE: second line must start with '1 '"
        )

    if not line2.startswith("2 "):
        raise ValueError(
            "Invalid TLE: third line must start with '2 '"
        )

    return name, line1, line2


def create_satellite(line1, line2):
    """
    Create an SGP4 satellite object from two TLE lines.
    """

    return Satrec.twoline2rv(line1, line2)


def normalize_datetime(timestamp):
    """
    Convert a datetime to UTC.

    If the datetime has no timezone information,
    UTC is assumed.
    """

    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)

    return timestamp.astimezone(timezone.utc)


def propagate(satellite, timestamp):
    """
    Propagate a satellite to a specific time.

    Args:
        satellite: SGP4 Satrec object
        timestamp: datetime object

    Returns:
        position_km: (x, y, z)
        velocity_km_s: (vx, vy, vz)

    Coordinate frame:
        TEME

    Units:
        position -> kilometres
        velocity -> kilometres/second
    """

    timestamp = normalize_datetime(timestamp)

    jd, fr = jday(
        timestamp.year,
        timestamp.month,
        timestamp.day,
        timestamp.hour,
        timestamp.minute,
        timestamp.second
        + timestamp.microsecond / 1_000_000,
    )

    error, position, velocity = satellite.sgp4(jd, fr)

    if error != 0:
        raise RuntimeError(
            f"SGP4 propagation failed with error code {error}"
        )

    return position, velocity


def load_satellite(tle_file):
    """
    Load a satellite from a TLE file.

    Returns:
        name: Satellite name
        satellite: SGP4 Satrec object
    """

    name, line1, line2 = load_tle(tle_file)

    satellite = create_satellite(
        line1,
        line2
    )

    return name, satellite


def propagate_from_tle(tle_file, timestamp):
    """
    Propagate a satellite from a TLE file to one timestamp.

    Returns:
        Dictionary containing satellite state.
    """

    name, satellite = load_satellite(tle_file)

    timestamp = normalize_datetime(timestamp)

    position, velocity = propagate(
        satellite,
        timestamp
    )

    return {
        "name": name,
        "norad_id": satellite.satnum,
        "timestamp": timestamp.isoformat(),
        "position_km": list(position),
        "velocity_km_s": list(velocity),
        "frame": "TEME",
    }


def propagate_trajectory(
    satellite,
    start_time,
    duration_seconds,
    step_seconds,
):
    """
    Generate a synchronized satellite trajectory.

    Args:
        satellite:
            SGP4 satellite object.

        start_time:
            Start time in UTC.

        duration_seconds:
            Total propagation duration.

        step_seconds:
            Time interval between points.

    Returns:
        List of trajectory points.

    Every trajectory point contains:
        timestamp
        position_km
        velocity_km_s
        frame
    """

    if duration_seconds < 0:
        raise ValueError(
            "duration_seconds must be non-negative"
        )

    if step_seconds <= 0:
        raise ValueError(
            "step_seconds must be greater than zero"
        )

    start_time = normalize_datetime(start_time)

    trajectory = []

    elapsed = 0

    while elapsed <= duration_seconds:

        timestamp = (
            start_time
            + timedelta(seconds=elapsed)
        )

        position, velocity = propagate(
            satellite,
            timestamp
        )

        trajectory.append(
            {
                "timestamp": timestamp.isoformat(),
                "position_km": list(position),
                "velocity_km_s": list(velocity),
                "frame": "TEME",
            }
        )

        elapsed += step_seconds

    return trajectory


def propagate_tle(
    tle_file,
    start_time,
    duration_seconds,
    step_seconds,
):
    """
    Main interface for the conjunction-detection module.

    Takes a TLE file and returns a complete synchronized
    trajectory.

    Returns:
        Dictionary containing:

        name
        norad_id
        frame
        position_unit
        velocity_unit
        start_time
        duration_seconds
        step_seconds
        trajectory
    """

    start_time = normalize_datetime(start_time)

    name, satellite = load_satellite(
        tle_file
    )

    trajectory = propagate_trajectory(
        satellite=satellite,
        start_time=start_time,
        duration_seconds=duration_seconds,
        step_seconds=step_seconds,
    )

    return {
        "name": name,
        "norad_id": satellite.satnum,
        "frame": "TEME",
        "position_unit": "km",
        "velocity_unit": "km/s",
        "start_time": start_time.isoformat(),
        "duration_seconds": duration_seconds,
        "step_seconds": step_seconds,
        "trajectory": trajectory,
    }


def save_trajectory(data, output_file):
    """
    Save propagation output as JSON.

    This is useful for debugging, testing,
    and passing data between components.
    """

    output_file = Path(output_file)

    output_file.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with output_file.open("w") as file:
        json.dump(
            data,
            file,
            indent=2
        )


def propagate_and_save(
    tle_file,
    start_time,
    duration_seconds,
    step_seconds,
    output_file,
):
    """
    Propagate a satellite and save its trajectory as JSON.

    Returns:
        The same propagation dictionary that was saved.
    """

    data = propagate_tle(
        tle_file=tle_file,
        start_time=start_time,
        duration_seconds=duration_seconds,
        step_seconds=step_seconds,
    )

    save_trajectory(
        data,
        output_file
    )

    return data