"""Validate the specification package, NOT the unimplemented SDK.

Run: python scripts/validate_handoff.py
Requires the Python jsonschema package (Draft 2020-12 support).
Does not install dependencies, start services or contact a network.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
checks: list[dict] = []
SPEC_ROOT_FILES = {
    "AGENTS.md", "README.md", "START-HERE.md", "TASKBOARD.json"
}
SPEC_DIRECTORIES = ("contracts", "docs", "fixtures", "prompts", "templates")


def specification_files(pattern: str = "*") -> list[Path]:
    """Return a bounded inventory of handoff inputs, never generated/runtime trees."""
    files = [ROOT / name for name in sorted(SPEC_ROOT_FILES) if (ROOT / name).match(pattern)]
    for directory in SPEC_DIRECTORIES:
        base = ROOT / directory
        if base.is_dir():
            files.extend(path for path in base.rglob(pattern) if path.is_file())
    return sorted(files)


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append({"name": name, "status": "PASS" if ok else "FAIL", "detail": detail})


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def agent_policy_errors(policy: dict, tasks: list[dict]) -> list[str]:
    """Return routing-policy violations without consulting or inventing runtime state."""
    errors: list[str] = []
    expected_roles = {
        "implementation": ("gpt-6.1-sol", "high"),
        "testing": ("gpt-6.1-sol", "high"),
        "ideas": ("gpt-6-astra", "high"),
        "coordination": ("gpt-6-astra", "high"),
        "orchestration": ("gpt-6-astra", "high"),
        "finalReview": ("gpt-6-astra", "high"),
    }
    roles = policy.get("roles", {})
    for role, (model, effort) in expected_roles.items():
        configured = roles.get(role, {})
        if (configured.get("model"), configured.get("reasoningEffort")) != (model, effort):
            errors.append(f"role {role} must use {model}/{effort}")
    spawn = policy.get("nativeSpawn", {})
    required_spawn = {
        "forkTurns": "none",
        "selfContainedTaskRequired": True,
        "explicitModelOverrideRequired": True,
        "conflictingFixedModelAgentTypeForbidden": True,
    }
    for key, value in required_spawn.items():
        if spawn.get(key) != value:
            errors.append(f"nativeSpawn.{key} must be {value!r}")
    runtime = policy.get("runtime", {})
    if runtime.get("silentFallback") != "forbidden" or runtime.get("unavailableRequiredModel") != "BLOCKED":
        errors.append("runtime must forbid silent fallback and map unavailable required model to BLOCKED")
    for task in tasks:
        expected = expected_roles["finalReview" if task.get("ownerRole") == "review" else "implementation"]
        actual = (task.get("model"), task.get("reasoningEffort"))
        if actual != expected:
            errors.append(f"task {task.get('id', '<missing>')} must use {expected[0]}/{expected[1]}")
    return errors


required = ["README.md", "AGENTS.md", "START-HERE.md", "TASKBOARD.json",
            "prompts/START-NEXT-SESSION.md", "templates/ci.yml.example",
            "contracts/recipe.schema.json", "contracts/request.schema.json",
            "contracts/approval-request.schema.json", "contracts/agent-policy.json",
            "contracts/technology-profile.json",
            "fixtures/attack-cases.json",
            "fixtures/medusa-scenarios.json"]
for rel in required:
    path = ROOT / rel
    check("required:" + rel, path.is_file() and path.stat().st_size > 0)
docs = sorted((ROOT / "docs").glob("*.md"))
check("domain-documents", len(docs) >= 12, str(len(docs)))

parsed = {}
for path in specification_files("*.json"):
    try:
        parsed[path.relative_to(ROOT).as_posix()] = read_json(path)
        check("json:" + path.name, True)
    except (ValueError, UnicodeError) as exc:
        check("json:" + path.name, False, str(exc))

try:
    from jsonschema import Draft202012Validator, FormatChecker
    for rel, schema in parsed.items():
        if rel.endswith(".schema.json"):
            Draft202012Validator.check_schema(schema)
            check("schema:" + rel, True)
    schema = parsed["contracts/recipe.schema.json"]
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for rel in ("contracts/recipe.example.json", "contracts/category-recipe.example.json",
                "contracts/channel-recipe.example.json"):
        recipe = parsed[rel]
        errors = [str(e.message) for e in validator.iter_errors(recipe)]
        check("recipe-schema:" + rel, not errors, "; ".join(errors))
        seen = set()
        used_params = set()
        caps = {"medusa.products.list", "medusa.products.retrieve"}
        valid = True
        used_effects = set()
        for step in recipe["steps"]:
            valid &= step["id"] not in seen and set(step["dependsOn"]) <= seen
            seen.add(step["id"])
            cap = step["capability"]
            valid &= cap not in used_effects
            used_effects.add(cap)
            kind = "categoryId" if "product_categories" in cap else "channelId"
            family = "product_categories" if kind == "categoryId" else "sales_channels"
            valid &= step["arguments"] == {"productId": {"$record": "id"}, kind: {"$param": kind}}
            used_params.add(kind)
            caps.update([cap, f"medusa.{family}.retrieve"])
        fields = [f["name"] for f in recipe["ui"]["fields"]]
        valid &= len(fields) == len(set(fields)) and set(fields) == used_params == set(recipe["parameters"])
        valid &= caps == set(recipe["requiredCapabilities"])
        expected_count = 2 if recipe["recipeKey"] == "catalog.campaign.prepare.v1" else 1
        valid &= len(recipe["steps"]) == expected_count
        check("recipe-semantics:" + rel, bool(valid))
except ImportError:
    check("jsonschema-dependency", False, "Install jsonschema in a task-local venv; validation was not run.")
except Exception as exc:
    check("schema-validation", False, str(exc))

fixtures = parsed.get("fixtures/medusa-scenarios.json", {})
try:
    tenants = fixtures["tenants"]
    check("two-independent-tenants", {t["key"] for t in tenants} == {"atlas", "boreal"})
    roles = {"admin", "requester", "operator", "viewer"}
    check("eight-actors-four-roles", sum(len(t["actors"]) for t in tenants) == 8 and all(
        {a["role"] for a in t["actors"]} == roles for t in tenants))
    products = fixtures["products"]
    eligible = [p for p in products if p["status"] == "published" and not p["locked"]]
    category_adds = {p["key"] for p in eligible if not p["campaignCategory"]}
    channel_adds = {p["key"] for p in eligible if not p["campaignChannel"]}
    expected = fixtures["expectedFreshRun"]
    check("fixture-oracle", category_adds == set(expected["categoryAdds"]) and
          channel_adds == set(expected["channelAdds"]) and
          len(category_adds) + len(channel_adds) == expected["semanticMutationCount"] and
          {p["key"] for p in eligible} == set(expected["eligible"]))
    ids = [s["id"] for s in fixtures["scenarios"]]
    check("medusa-case-ids", len(ids) == len(set(ids)) and len(ids) >= 14)
    cases = parsed["fixtures/attack-cases.json"]["cases"]
    attack_ids = [c["id"] for c in cases]
    check("attack-case-ids", len(attack_ids) == len(set(attack_ids)) and len(attack_ids) >= 24)
    check("synthetic-attacks-only", all(c["syntheticOnly"] for c in cases))
except (KeyError, TypeError) as exc:
    check("fixture-structure", False, str(exc))

board = parsed.get("TASKBOARD.json", {})
tasks = board.get("tasks", [])
task_ids = {t["id"] for t in tasks}
check("task-dependencies", bool(tasks) and len(task_ids) == len(tasks) and all(
    set(t["dependsOn"]) <= task_ids and t["id"] not in t["dependsOn"] for t in tasks))
resolved = set()
while True:
    additions = {t["id"] for t in tasks if set(t["dependsOn"]) <= resolved} - resolved
    if not additions:
        break
    resolved |= additions
check("task-graph-acyclic", resolved == task_ids)

agent_policy = parsed.get("contracts/agent-policy.json", {})
policy_errors = agent_policy_errors(agent_policy, tasks)
check("agent-policy-routing", not policy_errors, "; ".join(policy_errors))
negative_tasks = deepcopy(tasks)
if negative_tasks:
    negative_tasks[0]["model"] = "wrong-model"
negative_errors = agent_policy_errors(agent_policy, negative_tasks)
check("agent-policy-negative-model-rejected", any("task T00 must use" in error for error in negative_errors),
      "; ".join(negative_errors))

technology = parsed.get("contracts/technology-profile.json", {})
expected_workspaces = ["apps/service", "packages/contracts", "packages/sdk-react", "packages/medusa-plugin"]
check("technology-four-workspaces", technology.get("sourceWorkspaces") == expected_workspaces)
service = technology.get("service", {})
check("technology-one-service-two-entrypoints", service.get("artifactCount") == 1 and
      service.get("imageCount") == 1 and service.get("entrypoints") == ["api", "worker"] and
      service.get("internalModulesArePackagesOrDeployments") is False)
jobs = technology.get("jobs", {})
check("technology-single-pg-queue", jobs.get("tableCount") == 1 and
      jobs.get("kinds") == ["generation", "execution", "reconcile"] and
      jobs.get("outboxRequired") is False and jobs.get("listenNotifyRequired") is False and
      jobs.get("queueLibrary") is False)
transport = technology.get("transport", {})
check("technology-polling-no-push", transport.get("progress") == "HTTP polling" and
      transport.get("sseInMinimumApi") is False and transport.get("webSocketInMinimumApi") is False)
contracts_profile = technology.get("contracts", {})
check("technology-safe-schema-compilation", contracts_profile.get("jsonSchemaDialect") ==
      "https://json-schema.org/draft/2020-12/schema" and
      contracts_profile.get("ajvInDefaultSdkBundle") is False and
      contracts_profile.get("medusaSdkInDefaultSdkBundle") is False and
      contracts_profile.get("modelOrUserSchemasCompiled") is False)

acceptance_text = (ROOT / "docs/06-TDD-CI-AND-ACCEPTANCE.md").read_text(encoding="utf-8")
acceptance_ids = sorted(set(re.findall(r"\| (ACC-\d{3}) \|", acceptance_text)))
acceptance_numbers = [int(value.split("-")[1]) for value in acceptance_ids]
check("acceptance-inventory-consecutive", bool(acceptance_numbers) and
      acceptance_numbers == list(range(1, max(acceptance_numbers) + 1)), ",".join(acceptance_ids))
check("release-covers-all-defined-acceptance", "todos los criterios `acc-*` definidos y aplicables" in
      acceptance_text.lower())
traceability_text = (ROOT / "docs/12-REQUIREMENTS-TRACEABILITY.md").read_text(encoding="utf-8")
check("traceability-covers-all-defined-acceptance", "todos los `acc-*` definidos y aplicables" in
      traceability_text.lower())
attack_fixture_text = (ROOT / "fixtures/attack-cases.json").read_text(encoding="utf-8")
check("attack-fixture-no-stale-sse", "SSE" not in attack_fixture_text)
check("attack-fixture-no-ir-proof-required", "receta proofRequired" not in attack_fixture_text and
      "recipe proofRequired" not in attack_fixture_text)

for path in specification_files("*.md"):
    text = path.read_text(encoding="utf-8")
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        target = target.strip("<>")
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
            continue
        target = unquote(target.split("#", 1)[0])
        if target:
            dest = (path.parent / target).resolve()
            check("link:" + path.relative_to(ROOT).as_posix() + ":" + target, dest.exists())

manifest = []
for path in specification_files():
    manifest.append({"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
passed = all(c["status"] == "PASS" for c in checks)
report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "scope": "specification-package-only",
          "sdkImplemented": False, "sdkTestsExecuted": False,
          "status": "PASS" if passed else "FAIL", "checks": checks, "manifest": manifest}
(ROOT / "evidence").mkdir(exist_ok=True)
(ROOT / "evidence" / "handoff-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
for result in checks:
    if result["status"] != "PASS":
        print(result["status"], result["name"], result["detail"])
print(f"{report['status']}: {len(checks)} specification checks; {len(manifest)} files. No SDK tests executed.")
sys.exit(0 if passed else 1)
