"""Package the existing Next app for its GitHub unzip workflow; no secrets or workflows."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
output = root / "Basement-Control-Center-V35-CONTROL-CENTER.zip"
directories = ["app", "lib", "public", "supabase", "tests", "scripts"]
files = []
for name in directories:
    for file in (root / name).rglob("*"):
        relative = file.relative_to(root)
        if file.is_file() and not any(part.startswith(".") or part == "node_modules" or part == "__pycache__" for part in relative.parts):
            files.append(file)
for name in ["package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", "next-env.d.ts", "vercel.json", "README.md", "INSTALL-EL.md", "PUSH-OPERATIONS.md"]:
    file = root / name
    if file.exists():
        files.append(file)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert not any(".github" in name or ".env" in name or name.endswith(".zip") for name in names)
    assert "public/sw.js" in names and "app/dashboard/notifications-panel.tsx" in names
    assert "app/dashboard/reference-settings.tsx" in names and "app/dashboard/reference-sessions.tsx" in names
    assert "supabase/migrations/20260929213000_reference_control_center.sql" in names
    assert "app/dashboard/member-portal.tsx" in names and "lib/control-theme.tsx" in names
    json.loads(archive.read("public/manifest.webmanifest"))
print(f"{output.name}: {len(files)} files, {output.stat().st_size} bytes, ZIP verified")
