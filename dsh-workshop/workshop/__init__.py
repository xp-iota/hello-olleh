"""OS-neutral orchestration for this course workspace.

The course workspace owns content and appearance; `lusine-a-reves` owns the
renderers. Every value that differs between topics lives in `course.json` and
`profiles/`; every value that differs between operating systems is resolved at
runtime here. No generation logic is duplicated from lusine.
"""

__version__ = "0.1.0"
