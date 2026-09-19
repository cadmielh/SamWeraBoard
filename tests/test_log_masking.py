"""Jurnalele tehnice nu trebuie să conțină nicio cifră din CNP."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import local_extractor  # noqa: E402


def test_mask_cnp_reveals_no_digits():
    for cnp in ("1800101221144", "2900202334455", "12", "1"):
        masked = local_extractor.mask_cnp(cnp)
        assert not any(ch.isdigit() for ch in masked), masked
    assert local_extractor.mask_cnp("") == "–"
    assert local_extractor.mask_cnp("1800101221144") == "*" * 13
