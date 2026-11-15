# Monta o runtime do motor: Python embutido oficial + faster-whisper + server.py.
# Uso: powershell -File scripts/fw-runtime/build.ps1 -Out dist/fw-runtime
# Saída: <Out>/sta-fw-runtime-win64.zip, com python/ (python.exe assinado pela PSF), server.py e VERSION.
param(
  [string]$Out = 'dist/fw-runtime',
  [string]$PythonVersion = '3.12.10',
  [string]$Version = 'v1'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stage = Join-Path $Out 'stage'
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force (Join-Path $stage 'python') | Out-Null

# 1. Python embutido (zip oficial da python.org)
$embed = Join-Path $Out 'python-embed.zip'
Invoke-WebRequest -UseBasicParsing "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" -OutFile $embed
Expand-Archive $embed (Join-Path $stage 'python')
Remove-Item $embed

# 2. O ._pth do embutido ignora PYTHONPATH; inclui site-packages explicitamente.
$pth = Get-ChildItem (Join-Path $stage 'python') -Filter 'python*._pth' | Select-Object -First 1
Add-Content -Encoding ascii $pth.FullName 'Lib\site-packages'

# 3. Pacotes como wheels para cp312/win_amd64 (o pip do host pode ser de outra versão).
$site = Join-Path $stage 'python/Lib/site-packages'
$pyVer = ($PythonVersion -split '\.')[0..1] -join ''
python -m pip install --no-deps --only-binary=:all: --platform win_amd64 --python-version $pyVer --implementation cp `
  --target $site -r (Join-Path $PSScriptRoot 'requirements.txt') --quiet --disable-pip-version-check
if ($LASTEXITCODE) { throw "pip falhou ($LASTEXITCODE)" }
Get-ChildItem $site -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force

# 4. Servidor e versão
Copy-Item (Join-Path $root 'src/main/fw/server.py') $stage
Set-Content -Encoding ascii (Join-Path $stage 'VERSION') $Version

# 5. Zip
$zip = Join-Path $Out 'sta-fw-runtime-win64.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
'{0:N0} MB  {1}' -f ((Get-Item $zip).Length / 1MB), $zip
