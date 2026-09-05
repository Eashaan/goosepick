from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# court_number is now the canonical physical/display number. Never remap it to
# the group's local 1..N position.
replace_once(
    "src/components/public/GroupCourtPulse.tsx",
    '''const courtDisplayNumber = (courtIds: number[], cn: number): number => courtIds.indexOf(cn) + 1;''',
    '''const courtDisplayNumber = (_courtIds: number[], cn: number): number => cn;''',
)

replace_once(
    "src/pages/admin/AdminGroup.tsx",
    '''  // Map raw court_id → local 1-indexed display number\n  const courtDisplayNumber = (cn: number): number => {\n    const idx = courtNumbers.indexOf(cn);\n    return idx >= 0 ? idx + 1 : cn;\n  };''',
    '''  // court_number is already the physical/display number for this session.\n  const courtDisplayNumber = (cn: number): number => cn;''',
)

replace_once(
    "src/components/public/PersonalRoster.tsx",
    '''      const rawCourtNum = playerCurrentMatch?.court_number;\n      const displayNum = rawCourtNum && courtIds\n        ? courtIds.indexOf(rawCourtNum) + 1 || rawCourtNum\n        : rawCourtNum || courtId;''',
    '''      const rawCourtNum = playerCurrentMatch?.court_number;\n      const displayNum = rawCourtNum || courtId;''',
)

# Group chronology should follow global match order, while standalone keeps its
# local match_index semantics.
replace_once(
    "src/components/public/PersonalRoster.tsx",
    ''').sort((a, b) => a.match_index - b.match_index);''',
    ''').sort((a, b) => {\n      if (courtsInGroup > 1) {\n        return (a.global_match_index ?? a.match_index) - (b.global_match_index ?? b.match_index);\n      }\n      return a.match_index - b.match_index;\n    });''',
)

print("Group display-number fixes applied")
