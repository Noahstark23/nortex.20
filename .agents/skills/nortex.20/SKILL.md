```markdown
# nortex.20 Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns used in the `nortex.20` TypeScript codebase. It covers file and code organization, commit conventions, and testing patterns. While no specific frameworks or automated workflows are detected, this guide ensures consistency and clarity for contributors.

## Coding Conventions

### File Naming
- Use **PascalCase** for file names.
  - Example: `UserProfile.ts`, `OrderManager.test.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { User } from './User';
    ```

### Export Style
- Both named and default exports are used.
  - Named export example:
    ```typescript
    export function calculateTotal() { ... }
    ```
  - Default export example:
    ```typescript
    export default class OrderManager { ... }
    ```

### Commit Messages
- Use **conventional commits** with the `feat` prefix for new features.
  - Example: `feat: add user authentication middleware`
- Average commit message length: ~71 characters.

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- **Test Framework:** Unknown (not explicitly detected).
- **Test File Naming:** Suffix test files with `.test.` before the extension.
  - Example: `OrderManager.test.ts`
- **Test Placement:** Tests are located alongside the files they test or in dedicated test directories.
- **Test Example:**
  ```typescript
  // OrderManager.test.ts
  import { OrderManager } from './OrderManager';

  test('creates a new order', () => {
    const manager = new OrderManager();
    expect(manager.createOrder()).toBeDefined();
  });
  ```

## Commands
| Command         | Purpose                                      |
|-----------------|----------------------------------------------|
| /new-feature    | Start work on a new feature (use `feat:`)    |
| /run-tests      | Run all test files matching `*.test.*`        |
| /check-imports  | Review code for correct relative imports      |
| /format-files   | Ensure PascalCase file naming conventions     |
```