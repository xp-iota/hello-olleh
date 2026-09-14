"""Shared runtime package for the offline iota modules."""

import logging

# Optional kernel integrations may be absent in the offline environment.
logging.disable(logging.CRITICAL)
