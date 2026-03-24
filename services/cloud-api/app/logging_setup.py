from __future__ import annotations

import logging


def configure_cloud_logging(debug: bool) -> logging.Logger:
    logger = logging.getLogger("notebook.cloud")
    level = logging.DEBUG if debug else logging.INFO
    logger.setLevel(level)
    if logger.handlers:
        return logger
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s [notebook.cloud] %(levelname)s: %(message)s"),
    )
    logger.addHandler(handler)
    return logger
