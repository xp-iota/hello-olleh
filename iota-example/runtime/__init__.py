"""Shared runtime package for the iota-example modules."""

import logging

# Optional kernel integrations may be absent in a minimal environment.
logging.disable(logging.CRITICAL)
