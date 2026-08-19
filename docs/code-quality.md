# Code quality

Review criteria, not laws. Exceptions OK: contract, boundary, perf, framework, compatibility, ops. Explain why.

## Rules

- **Single responsibility.** One fn = one semantic purpose. Inputs, output, effects, failures align. SRP lens, not rigid SOLID law.
- **Orchestration ≠ operations.** Separate sequencing/policy from parse/validate/store/format/UI work.
- **Coherent contract.** Unit must not mix incompatible questions, transforms, effects, error policies.
- **Contextual errors.** Handle error where meaning is knowable: recover, translate, contextualize, propagate. Exceptions justified.
- **Names.** Name public params by caller concept, not impl detail. Derived locals: `resolvedX`/`effectiveX`/`normalizedX`. Actions: `resolveProvider`, `saveArtifact`; predicates: `isValidProvider`, `hasSession`. Examples, not taxonomy.

## Ask

- One semantic purpose? Where would change split it?
- Orchestration or elementary operation?
- Inputs/output/effects/failures coherent?
- Error context sufficient? Exception explained?
- Name describes role/contract?
- Tests cover observable success, failure, boundaries?

## Provider

`resolveProvider(p)` uses explicit/default provider, decides invalid-provider error. `isValidProvider(p)` answers validity only; no error policy, no throw. Split may vary by contract.

## Automation

Run, interpret, report lint. Never ignore failures.

```text
npm run lint
```

ESLint automates complexity, file size, redundant control flow, unreachable/duplicate code, related TS checks. `max-params` warns: existing debt visible, no broad refactor. Type-dependent/semantic rules remain review work unless reliably configurable. Pair lint with focused deterministic tests; report unverifiable parts.
