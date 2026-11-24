# Unitalk build, signing, and release runbook

Based on the build session of **13 November 2026**. Commands run from the repository root unless noted. This report records observed results and reusable procedures; a successful build or valid signature does not prove installation, login, or application behavior.

## 1. Choose the artifact

| Goal | Build host | Selection | Result |
|---|---|---|---|
| Windows app with local agent | Native Windows x64 or ARM64 | `--variant bundled` | MSIX and unpacked app directory |
| Remote-only desktop client | Native target OS | `--variant light` | Desktop client without bundled Python/local agent |
| Microsoft Store submission | Native Windows | `--variant store`, stable claim required | Store-identity package; Store signs the package envelope |
| macOS desktop | macOS with developer tools | `--variant bundled` | DMG/ZIP; distribution requires Apple signing/notarization |
| Linux desktop | Linux | `--variant bundled` | Local AppImage; Linux desktop release jobs are currently disabled |
| Standard server container | Docker, native Linux architecture preferred | `HERMES_BOT_DESKTOP=0` (default) | Agent, dashboard, and browser-hosted desktop renderer |
| Bot Screen server container | Docker | `HERMES_BOT_DESKTOP=1` | Additional desktop/VNC packages |

**MSIX versus EXE:** MSIX installs the complete Windows package and registers its identity. The EXE inside `win-unpacked` is the application executable, not an installer or standalone portable file; it needs the surrounding resources. Test the MSIX for packaged behavior.

The current MSIX minimum is **Windows 11 22H2, build 22621**. Ubuntu can build the Linux container and dispatch Windows builds, but the complete Windows bundled pipeline needs a Windows host. An Azure Windows VM counts as a local native build host; GitHub Actions is optional.

## 2. Resources used in this session

| Setting | Value |
|---|---|
| GitHub repository | `unitalkai/unitalk-desktop` |
| Feature branch | `feat/unitalk-clerk-electron` |
| Azure subscription | `843a7d4d-5afe-40e1-af78-b74ec0c26dae` |
| Azure tenant | `e3b88a4f-fdb6-49d5-a062-b22fcda3bb76` |
| Build resource group | `UNITALK-DESKTOP-RELEASE-PROD` |
| Windows VM | `unitalk-github-action-runner-windows` |
| VM size when inspected | `Standard_D2s_v3`, 2 vCPU / about 8 GB RAM |
| ACR | `crunitalkdesktopfc.azurecr.io` |
| Container repository | `unitalk-desktop` |
| Public artifact origin | `https://downloads.unitalk.ai` |
| GitHub signing environment | `release-signing` |
| Azure Artifact Signing account | `unitalkdesktopsigning` |
| Signing endpoint | `https://neu.codesigning.azure.net` |
| Certificate profile | `unitalk-desktop`, Public Trust |
| Certificate subject / MSIX publisher | `CN=Unitalk AI, O=Unitalk AI, L=Saint-Denis, C=FR` |

These identifiers are not credentials. Authentication tokens, private keys, passwords, and storage secrets must not go in this document or build arguments.

## 3. Select the source revision

```bash
git status --short --branch
git fetch origin feat/unitalk-clerk-electron
# First checkout only:
git switch --track origin/feat/unitalk-clerk-electron
# For subsequent updates while already on the branch:
git merge --ff-only origin/feat/unitalk-clerk-electron
git rev-parse HEAD
```

Resolve or preserve existing work before switching. Native complete builds require a clean checkout and package the selected commit. Record the full SHA, not just the branch name. A VM-only patch commit is a different revision from its upstream base and must be reported as such.

## 4. Create and inspect builds through GitHub

### Commit build: downloadable test artifacts, no release

Preview the dispatch through the repository CLI:

```bash
export CLOUDFLARE_R2_PUBLIC_URL=https://downloads.unitalk.ai
python3 scripts/release.py --build-commit origin/feat/unitalk-clerk-electron --remote origin
# Add --publish to actually dispatch this commit build.
```

In this mode, `--publish` means dispatch/stage commit artifacts, not publish a GitHub release. To explicitly select Windows x64 only, dispatch the existing workflow from the default branch:

```bash
SHA=$(git rev-parse HEAD)
gh workflow run desktop-bundled-release.yml \
  --repo unitalkai/unitalk-desktop --ref main \
  -f build_commit="$SHA" -f jobs=win32-x64 -f upload_release=false
```

For a universal Windows bundle use `jobs=win32-x64,win32-arm64,win32-bundle`. Both architectures must be built before bundle assembly. The commit must already be pushed. The default-branch workflow controls dispatch; the admitted commit controls the built source.

This workflow stages files in R2, using `releases/commit/<FULL_SHA>/` for commit builds. Check the run summary for receipt-backed download links. Do not assume installers are GitHub Actions artifacts: this pipeline uses R2 handoff receipts.

### Inspect progress, jobs, and failures

```bash
gh run list --repo unitalkai/unitalk-desktop --workflow desktop-bundled-release.yml --limit 10
gh run view RUN_ID --repo unitalkai/unitalk-desktop
gh run view RUN_ID --repo unitalkai/unitalk-desktop --json status,conclusion,jobs,url
gh run view RUN_ID --repo unitalkai/unitalk-desktop --log-failed
gh run view --repo unitalkai/unitalk-desktop --job JOB_ID --log
gh run watch RUN_ID --repo unitalkai/unitalk-desktop --exit-status
```

`gh run watch` observes a run without cancelling it. A queued run is not proof that a matching runner exists. Check the workflow's `runs-on` labels and runner availability. Registering a VM as a runner is separate from simply creating the VM.

For a retry after understanding the failure:

```bash
gh run rerun RUN_ID --repo unitalkai/unitalk-desktop --failed
```

### Stable releases and variants

The committed project version is `0.0.0`; **do not bump it on main**. The release controller derives versions and creates annotated `rc.N-vX.Y.Z` claims. An outstanding attempt blocks another release.

```bash
export CLOUDFLARE_R2_PUBLIC_URL=https://downloads.unitalk.ai
git fetch origin main --tags
SHA=$(git rev-parse origin/main)

# Default release, all default build/test lanes except Termux:
python3 scripts/release.py release --commit "$SHA" --bump patch --remote origin

# Default lanes with Apple and Microsoft Store publishing omitted:
python3 scripts/release.py release --commit "$SHA" --bump patch \
  --without macos-arm64,windows-store --remote origin

# Narrow Windows-only build with native smoke tests:
python3 scripts/release.py release --commit "$SHA" --bump patch \
  --only windows,smoke --remote origin
```

Choose one command, not all three. `--without macos-arm64` omits the Apple release lane; it does not necessarily remove macOS test jobs inside independent CI, PM, or install-test workflows. `--only` replaces the default lane set, so `--only windows,smoke` omits full CI and the other acceptance suites.

Add `--autopublish` only when publication after passing checks is intended. Otherwise the result stays a draft. If the initial historical changelog exceeds GitHub's limit, use `--no-changelog` and write concise release notes while preserving controller markers.

```bash
# Publish a green draft through the controller:
python3 scripts/release.py publish --version X.Y.Z --remote origin
# Explicitly retire a failed attempt before recutting:
python3 scripts/release.py abandon --version X.Y.Z --remote origin
```

`abandon` deletes the draft, cancels active attempt runs, and records an abandonment marker; it retains the attempt tag. Never manually publish the draft in GitHub or dispatch stable release with the final `vX.Y.Z` tag. The controller creates that tag as a publication receipt.

**Current channel constraint:** stable desktop feeds advance only when both Windows and macOS desktop packages are built. Omitting Apple can produce a partial release, but does not advance the stable desktop update channel. This is enforced by `scripts/releases/lanes.py`.

## 5. Local native desktop builds

### Windows prerequisites

Use a short checkout such as `C:\u`. Install Git, bootstrap Python 3.11+, and Visual Studio C++ Build Tools with an appropriate Windows SDK. The complete builder obtains pinned Node, pnpm, Python, and packaging tools through PM. ARM64 has additional native preparation requirements; build it on ARM64.

Enable long paths on a Windows build VM if disabled (elevated PowerShell):

```powershell
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
  -Name LongPathsEnabled -Value 1 -Type DWord
```

Start new build processes after the change. A short checkout alone was insufficient for long Python bytecode filenames in this session.

### Unsigned bundled test build

```powershell
scripts\build-bundle.ps1
```

This convenience wrapper clears Azure signing variables deliberately. For a signed build, use the direct Python driver below instead.

### Direct commit build: bundled or light

```powershell
$sha = git rev-parse HEAD
python scripts/bundles/desktop.py --commit $sha --variant bundled
# Remote-only client, as a separate build:
python scripts/bundles/desktop.py --commit $sha --variant light --clean
```

On Linux/macOS use the same direct driver with the host's Python command. The target comes from the host. Outputs go to `apps/desktop/release/`. Commit packages use the version in that commit's project metadata, so these test files were named `0.0.0`; this is not a stable release version.

Use separate checkouts to retain several variants. `--clean` removes the selected checkout's previous build outputs under its build lock. Never use it on a checkout whose old installer you intend to preserve.

### Separate preparation from packaging

```powershell
$sha = git rev-parse HEAD
python scripts/bundles/desktop.py --commit $sha --variant bundled --prepare-only `
  --work C:\u\.build\desktop-job --cache C:\u\.cache\desktop-inputs
python scripts/bundles/desktop.py --prepared C:\u\.build\desktop-job\prepared.json
```

Dependency caches can be reused, but `prepared.json` contains job-local absolute paths. Relocating a checkout or changing source inputs requires fresh preparation. Do not pre-create the work directory. An old work directory cannot be reassigned by editing its ownership receipt.

### Store and ordinary Electron packaging

`scripts\build-bundle.ps1 -Store` creates an unsigned local Store package using a temporary stable claim. It requires usable published stable tags on the selected remote. Direct stable builds require the matching `RELEASE_CLAIM_TAG` and `RELEASE_CLAIM_OBJECT`; a bare `--tag vX.Y.Z` is not sufficient in the current code.

Store builds require **Unitalk's own Partner Center identity**. The feature branch still carried the upstream Store identity, so Store submission was not configured or validated here.

For ordinary desktop packaging, from `apps/desktop` with the pinned workspace tooling available:

```bash
pnpm run pack       # unpacked app
pnpm run dist:win   # MSIX
pnpm run dist:mac   # macOS artifacts, on macOS
```

These commands do not stage a fresh complete agent payload. Use the complete native driver for the bundled user experience.

## 6. Windows signing with Azure

### GitHub OIDC configuration

The `release-signing` environment was configured with:

```text
AZURE_SIGN_ENDPOINT=https://neu.codesigning.azure.net
AZURE_SIGN_ACCOUNT=unitalkdesktopsigning
AZURE_SIGN_PROFILE=unitalk-desktop
AZURE_SIGN_PUBLISHER=CN=Unitalk AI, O=Unitalk AI, L=Saint-Denis, C=FR
AZURE_CLIENT_ID=f98d4fa4-7d74-4cf4-b812-89209ad797d7
AZURE_TENANT_ID=e3b88a4f-fdb6-49d5-a062-b22fcda3bb76
```

The app registration is `unitalk-desktop-artifact-signing`. Its service principal has **Artifact Signing Certificate Profile Signer**, scoped to the certificate profile. The workflow uses `id-token: write`, Azure login, and a federated token for the signing library; no client secret was created.

This repository uses GitHub immutable OIDC subjects. The observed federated subject was:

```text
repo:unitalkai@176995572/unitalk-desktop@1453942885:environment:release-signing
```

Check `gh api repos/unitalkai/unitalk-desktop/actions/oidc/customization/sub` before recreating federation; do not substitute the older name-only subject blindly.

### Local VM managed identity

The VM has a system-assigned identity. Its client ID is `57a93ef9-c066-4cbf-9ed5-19d35c6ea355`; its principal/object ID is `9c009aa7-a11f-42f4-8d27-0c4ea2108e91`. Client and principal IDs are different.

Grant the profile signer role only for the build window and record the returned role-assignment ID. Configure the build process:

```powershell
$env:AZURE_SIGN_ENDPOINT = 'https://neu.codesigning.azure.net'
$env:AZURE_SIGN_ACCOUNT = 'unitalkdesktopsigning'
$env:AZURE_SIGN_PROFILE = 'unitalk-desktop'
$env:AZURE_SIGN_PUBLISHER = 'CN=Unitalk AI, O=Unitalk AI, L=Saint-Denis, C=FR'
$env:AZURE_CLIENT_ID = '57a93ef9-c066-4cbf-9ed5-19d35c6ea355'
$env:AZURE_TOKEN_CREDENTIALS = 'prod'
$env:GITHUB_REPOSITORY = 'unitalkai/unitalk-desktop'
$env:CLOUDFLARE_R2_PUBLIC_URL = 'https://downloads.unitalk.ai'
python scripts/bundles/desktop.py --commit (git rev-parse HEAD) --variant bundled
```

The manifest publisher in `scripts/msix-shared.mjs` must exactly match the certificate subject; environment variables alone do not replace that constant. Set the sideload publisher display name in `apps/desktop/electron-builder.config.cjs` too. Branches predating the signing commit need these changes.

### Verify before handing off

```powershell
$package = 'C:\u\apps\desktop\release\Unitalk-0.0.0-win-x64.msix'
$signtool = 'C:\u\.build\desktop-job\packager\winCodeSign\x64\signtool.exe'
& $signtool verify /pa /tw /v $package
if ($LASTEXITCODE -ne 0) { throw 'Package signature verification failed' }
Get-AuthenticodeSignature $package | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
Get-FileHash $package -Algorithm SHA256
# Repeat for the product EXE inside release\win-unpacked.
```

Then remove the temporary assignment using `az role assignment delete --ids ROLE_ASSIGNMENT_ID` and verify it is absent. Preserve the artifact, full source revision, hashes, and signature result. Installation and interactive application smoke tests are separate checks.

## 7. Run and inspect a build on the Azure VM

Azure **Action Run Command** (`az vm run-command invoke`) permits only one active action command, returns only the final output tail, and has a 90-minute execution limit. It is a poor choice for long builds or live logs. A local shell timeout/error is not proof that its remote child has stopped.

For future long builds, use **Managed Run Command** with an explicit timeout and a build script that writes durable stdout, stderr, and an exit-code/result file. Keep observer output bounded:

```bash
az vm run-command create -g UNITAlK-DESKTOP-RELEASE-PROD \
  --vm-name unitalk-github-action-runner-windows \
  --name unitalk-build-UNIQUE_ID --location francecentral \
  --async-execution true --timeout-in-seconds 14400 --no-wait \
  --script '...build wrapper with durable logs and exit status...'

az vm run-command show -g UNITAlK-DESKTOP-RELEASE-PROD \
  --vm-name unitalk-github-action-runner-windows \
  --name unitalk-build-UNIQUE_ID --expand instanceView
```

`--expand instanceView` worked in this session but the installed CLI reports it deprecated; consult the current CLI help when upgrading. Managed Run Command can expose the last output while running and can stream larger output to customer-controlled append blobs. That blob streaming was not configured in this session.

To inspect an existing action build without issuing a competing action command, a separate managed command successfully read these logs:

```powershell
Get-Content 'C:\unitalk-local-test-fa7c9dd\branch-build2.stdout.log' -Tail 15
Get-Content 'C:\unitalk-local-test-fa7c9dd\branch-build2.stderr.log' -Tail 15
```

This is a snapshot, not a continuous listener. Inspect `instanceView.executionState`, timestamps, exit code, and output: `provisioningState` still said `Creating` after the observer script had succeeded. Deleting an active managed command can terminate its script; do not delete the build command to refresh its status.

CPU activity and a healthy VM agent establish only that the VM is alive. Successful completion requires the wrapper result or independently verified finished artifacts. Do not revoke signing access while `signtool` still needs it.

## 8. Build a branch container locally and push to ACR

This procedure built the standard **Linux/amd64** variant successfully. Use the pinned branch SHA as the source and tag suffix. A clean Git archive avoids including ignored local build archives and other local state.

```bash
set -euo pipefail
git status --short --branch
git fetch origin feat/unitalk-clerk-electron
git merge --ff-only origin/feat/unitalk-clerk-electron
SHA=$(git rev-parse HEAD)
COMMIT_DATE=$(git log -1 --format=%ct)
CONTEXT=$(mktemp -d /tmp/opencode/unitalk-image-XXXXXXXX)
export DOCKER_CONFIG=$(mktemp -d /tmp/opencode/unitalk-acr-auth-XXXXXXXX)
IMAGE=crunitalkdesktopfc.azurecr.io/unitalk-desktop
TAG="feat-unitalk-clerk-electron-${SHA:0:12}"

git archive "$SHA" | tar -x -C "$CONTEXT"
python3 scripts/ci/check_profile_archive_boundary.py --root "$CONTEXT"
python3 scripts/write_install_stamp.py --output "$CONTEXT/install-stamp.json" \
  --distribution docker --update-mechanism external --source local \
  --commit "$SHA" --branch feat/unitalk-clerk-electron --commit-date "$COMMIT_DATE"

az acr login --name crunitalkdesktopfc
docker build --platform linux/amd64 --build-arg HERMES_DOCKER_IMAGE="$IMAGE" \
  --tag "$IMAGE:$TAG" "$CONTEXT"

docker run --rm --network none --entrypoint /opt/hermes/.venv/bin/python \
  "$IMAGE:$TAG" -c 'import json,sys; s=json.load(open("/opt/hermes/install-stamp.json")); assert s["commit"]==sys.argv[1]; print(s["commit"])' "$SHA"
docker push "$IMAGE:$TAG"
az acr repository show --name crunitalkdesktopfc --image "unitalk-desktop:$TAG" --query digest -o tsv
docker logout crunitalkdesktopfc.azurecr.io
```

Compare the digest returned by ACR with the digest printed by `docker push`. For Bot Screen, add `--build-arg HERMES_BOT_DESKTOP=1` and use a separate tag such as `${TAG}-desktop`. For ARM64 use a native ARM64 builder and `--platform linux/arm64`; ARM64 was not built in this session.

The Docker variant named `desktop` means Bot Screen packages, not the Windows Electron application. The standard image already includes the browser-hosted renderer. Building that image does not exercise Electron's Clerk bridge or prove authentication works. Full Docker integration tests are run through `scripts/run_tests.sh tests/docker/` with `HERMES_TEST_IMAGE` pointing to the built image; the session only checked embedded provenance and basic Python runtime execution.

## 9. Observed failures and resolutions

| Symptom | Evidence and response |
|---|---|
| Release channel authority mismatch | Local CLI defaulted to the upstream Hermes host. Set `CLOUDFLARE_R2_PUBLIC_URL=https://downloads.unitalk.ai`. |
| Release notes exceed GitHub limit | Initial history produced about 4 million characters. Used `--no-changelog`; no claim was created by the rejected attempt. |
| GitHub says local `setup-pm/action.yml` missing | The file exists in the committed tree, but runner execution could not find it. Root cause remains unresolved; do not mark GitHub release infrastructure healthy. |
| Old universal-bundle filename selector | Main's signing commit switched the updater workflow from hardcoded `HermesBundled` to the product identity. That fix is not necessarily on the feature branch. |
| Electron terminal probe times out | Newly extracted Electron needed about 47 seconds on the VM; warm launches took about 1.4 seconds. Raising the outer probe timeout from 15 to 90 seconds passed the actual native probe. |
| Long Python filenames fail | Moved the checkout to `C:\u` and enabled `LongPathsEnabled=1`. The short path alone did not solve bytecode generation. |
| Work directory belongs to old checkout | Relocated `prepared.json`/work state is invalid. Preserve or deliberately discard build-owned state, then prepare again; never falsify its ownership. |
| `ERR_PNPM_IGNORED_BUILDS` | Clerk dependencies introduced banner-only scripts. Inspected them and added `browser-tabs-lock@1.3.0: false` and `core-js@3.47.0: false` under `allowBuilds` in the VM-only checkout. Kept strict build policy enabled. |
| Docker context archive check fails | Ignored dependency-cache tarballs triggered the repository check. Built from a clean Git archive; retained original caches. |
| `Shell.NotFoundError` from harness | Lost command tracking, not a demonstrated remote build failure. Queried managed observer output and remote state. |
| Second action run-command conflicts | Azure permits only one active action invocation. A separately named managed read-only observer worked. |

## 10. Artifact history and remaining work

### Verified first Windows test build

- Base commit: `fa7c9ddab84bcee7e2af394bacec41bddc810bfd` (main signing changes).
- VM-only timeout commit: `c0cc50830c5c14c72f18956deef3649b0b2bd721`.
- MSIX: `C:\u\apps\desktop\release\Unitalk-0.0.0-win-x64.msix` (2,797,247,847 bytes).
- MSIX SHA-256: `0ff5640f742a79f830c4d64c87fe983bfbac67cdae0d88916d072c23402f6de8`.
- EXE: `C:\u\apps\desktop\release\win-unpacked\unitalk-c0cc508.exe`.
- MSIX and EXE passed `signtool verify /pa /tw` and Authenticode checks as Unitalk AI, with timestamps. Temporary VM signing permission was removed after verification.
- Application launch, installation, and login were not verified.

### Feature-branch Windows build: not yet verified complete

- Base commit: `c7b9477dd093d15b5c8019299bba55786255024b`.
- VM-only signing/timeout commit: `1d243257afb52c5c8e74a71af74ba0bd33765f87`.
- VM-only dependency-policy commit used by the build: `4d28dc9967e8720d74e41818385ea045dd0ac649`.
- Checkout/output root: `C:\u2`; expected product EXE is `unitalk-4d28dc9.exe`.
- Latest observed snapshot at **22:55 UTC** showed MSIX signing in progress. The local tracking shell ended with `Shell.NotFoundError`; a later action invocation still reported an execution conflict.
- **Pending:** confirm remote completion, verify both signatures and hashes, then revoke temporary role assignment `c658351c-7953-4a0a-b5fd-a80a3a847f0b` on the signing profile. Do not confuse the verified `C:\u` artifact with the newer `C:\u2` artifact.

### Verified container uploads

| Tag under `crunitalkdesktopfc.azurecr.io/unitalk-desktop` | Registry digest |
|---|---|
| `feat-unitalk-clerk-electron-adb24af0920f` | `sha256:f2b223e47f1351b607b5feeba24ee144ee668da6c38e92dbce771f39e88c79bf` |
| `feat-unitalk-clerk-electron-c7b9477dd093` | `sha256:b97496b48e0d33f9d59ca14596b50ee6922b0dddf3e3cd24ccb540710144f403` |

Both are Linux/amd64 standard images. No deployment or end-to-end authentication test was performed. The feature branch's latest change embeds a public Clerk publishable key; web configuration still gates Clerk on an Electron bridge, so a container build alone is not an Electron authentication test.

The failed `rc.4-v0.21.6` and `rc.5-v0.21.6` attempts were abandoned through the controller. No successful public release was established during this conversation. Apple signing/notarization and Unitalk Store submission credentials were absent when inspected; future operators must recheck current settings.

## References and precedence

- [Desktop build guide](../apps/desktop/BUILDING.md)
- [Stable release procedure](../website/docs/developer-guide/stable-releases.md)
- [Workflow guide](../.github/workflows/README.md)
- [Desktop driver](../scripts/bundles/desktop.py) and [admission/preparation](../scripts/bundles/desktop_prepare.py)
- [Release lane authority](../scripts/releases/lanes.py)
- [Docker workflow](../.github/workflows/docker.yml)
- [Azure Run Command comparison](https://learn.microsoft.com/en-us/azure/virtual-machines/run-command-overview)
- [Managed Run Command for Windows](https://learn.microsoft.com/en-us/azure/virtual-machines/windows/run-command-managed)

When older documentation conflicts with current code, use the code: notably, `project.version` remains `0.0.0` on main, and direct stable native preparation requires claim metadata. Recheck workflow inputs and CLI `--help` after switching branches.
