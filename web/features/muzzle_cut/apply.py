"""Muzzle Normalization Carver.

Logic is now implemented as a preprocessing step in prototype_v11_mabr.py
to allow for dynamic grid expansion. This dummy apply function satisfies
the plugin loader.
"""

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    return cavity_bin, origin
