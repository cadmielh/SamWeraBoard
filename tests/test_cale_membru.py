"""Căile `members.<uid>.role` din interogări trebuie citate: Firestore refuză un uid care începe cu o cifră într-o cale
necitată (ștergerea contului cădea cu 500 pentru aproximativ un utilizator din șase)."""
import workspace_deletion


def test_cale_rol_citeaza_uid_care_incepe_cu_cifra():
    assert workspace_deletion.cale_rol_membru("3C7x5Z4dY2m65m4McFm9oCtoW7n8") == "members.`3C7x5Z4dY2m65m4McFm9oCtoW7n8`.role"
    assert workspace_deletion.cale_rol_membru("abc") == "members.abc.role"
