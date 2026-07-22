"""Verify that SUMO, TraCI, and sumolib can run a minimal simulation."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import quoteattr


class SumoVerificationError(RuntimeError):
    """Raised when the local SUMO installation cannot be verified."""


def _find_binary(name: str) -> Path | None:
    candidates: list[Path] = []
    sumo_home = os.environ.get("SUMO_HOME")
    if sumo_home:
        candidates.append(Path(sumo_home) / "bin" / name)

    path_binary = shutil.which(name)
    if path_binary:
        candidates.append(Path(path_binary))

    candidates.append(Path(sys.prefix) / "bin" / name)
    if sys.platform == "win32":
        candidates.extend(candidate.with_suffix(".exe") for candidate in list(candidates))

    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), None)


def sumo_is_available() -> bool:
    """Return whether the native binaries and Python bindings are discoverable."""
    if _find_binary("sumo") is None or _find_binary("netgenerate") is None:
        return False

    try:
        import sumolib  # noqa: F401
        import traci  # noqa: F401
    except ImportError:
        return False
    return True


def verify_sumo_installation() -> None:
    """Generate a tiny network and advance a SUMO simulation by one second."""
    sumo_binary = _find_binary("sumo")
    netgenerate_binary = _find_binary("netgenerate")
    if sumo_binary is None or netgenerate_binary is None:
        raise SumoVerificationError(
            "SUMO executables were not found. Install SUMO and add its bin directory to PATH "
            "or set SUMO_HOME."
        )

    try:
        import sumolib
        import traci
    except ImportError as exc:
        raise SumoVerificationError(
            "SUMO Python bindings are missing. Install traci and sumolib in this environment."
        ) from exc

    with tempfile.TemporaryDirectory(prefix="g11-sumo-") as temporary_directory:
        workdir = Path(temporary_directory)
        network_path = workdir / "minimal.net.xml"
        routes_path = workdir / "minimal.rou.xml"

        subprocess.run(
            [
                str(netgenerate_binary),
                "--grid",
                "--grid.number",
                "2",
                "--output-file",
                str(network_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )

        network = sumolib.net.readNet(str(network_path))
        usable_edges = [
            edge
            for edge in network.getEdges()
            if not edge.isSpecial() and edge.getLength() > 10 and edge.allows("passenger")
        ]
        if not usable_edges:
            raise SumoVerificationError("The generated SUMO network has no passenger edge.")

        edge_id = quoteattr(usable_edges[0].getID())
        routes_path.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<routes>\n"
            '  <vType id="car" vClass="passenger" accel="2.6" decel="4.5"/>\n'
            f'  <route id="route0" edges={edge_id}/><vehicle id="vehicle0" '
            'type="car" route="route0" depart="0"/>\n'
            "</routes>\n",
            encoding="utf-8",
        )

        started = False
        try:
            traci.start(
                [
                    str(sumo_binary),
                    "--net-file",
                    str(network_path),
                    "--route-files",
                    str(routes_path),
                    "--begin",
                    "0",
                    "--end",
                    "1",
                    "--step-length",
                    "1",
                    "--no-step-log",
                    "true",
                    "--no-warnings",
                    "true",
                ]
            )
            started = True
            traci.simulationStep(1.0)
            if traci.simulation.getTime() < 1.0:
                raise SumoVerificationError("SUMO did not advance to one simulated second.")
        finally:
            if started:
                traci.close()


def main() -> int:
    try:
        verify_sumo_installation()
    except (OSError, subprocess.CalledProcessError, SumoVerificationError) as exc:
        print(f"SUMO verification failed: {exc}", file=sys.stderr)
        return 1

    print("SUMO installation verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
