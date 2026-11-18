"""Șabloanele de bază cu formular dedicat sunt listate de două ori: DEDICATED_KEYS în frontend
(frontend/src/lib/templateChanges.ts) și DEDICATED_FORM_KEYS în templates_api.py. Un formular nou adăugat doar într-una
dintre liste s-ar comporta diferit în aplicație și pe server — testul le ține la fel.

Fișierele se citesc ca text (fără a importa templates_api, care pornește Firebase)."""
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "frontend" / "src" / "lib"


def _python_keys() -> set[str]:
    tree = ast.parse((ROOT / "templates_api.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "DEDICATED_FORM_KEYS" for t in node.targets):
            return set(ast.literal_eval(node.value.args[0]))   # frozenset({...})
    raise AssertionError("DEDICATED_FORM_KEYS lipsește din templates_api.py")


def _frontend_keys() -> set[str]:
    src = (LIB / "templateChanges.ts").read_text(encoding="utf-8")
    m = re.search(r"const DEDICATED_KEYS = \[([^\]]*)\]", src)
    assert m, "DEDICATED_KEYS lipsește din templateChanges.ts"
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    # Valorile constantelor (ex. ANEXA1_KEY = 'anexa1_inregistrare_fiscala'), din modulele frontend-ului
    consts: dict[str, str] = {}
    for f in LIB.glob("*.ts"):
        for name, value in re.findall(r"export const (\w+_KEY) = '([^']+)'", f.read_text(encoding="utf-8")):
            consts[name] = value
    missing = [n for n in names if n not in consts]
    assert not missing, f"constante negăsite în frontend/src/lib: {missing}"
    return {consts[n] for n in names}


def test_dedicated_keys_match_between_frontend_and_server():
    assert _frontend_keys() == _python_keys()
