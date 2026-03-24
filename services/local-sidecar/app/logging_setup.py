from __future__ import annotations

import logging


def configure_sidecar_logging(debug: bool) -> logging.Logger:
    logger = logging.getLogger("notebook.sidecar")
    level = logging.DEBUG if debug else logging.INFO
    logger.setLevel(level)
    if logger.handlers:
        return logger
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s [notebook.sidecar] %(levelname)s: %(message)s"),
    )
    logger.addHandler(handler)
    return logger
