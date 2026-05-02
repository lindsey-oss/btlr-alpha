# Parser Fixture Library

Each fixture is a real-world inspection PDF paired with an `.expected.json` file
that defines what the parser MUST extract from that PDF.

## Adding a new fixture

1. Drop the PDF here: `your-fixture-name.pdf`
2. Create a sibling file: `your-fixture-name.expected.json` (see schema below)
3. Run the test suite: `npm test`

## Expected JSON schema

```json
{
  "description": "Human-readable description of this fixture",
  "source": "Inspection software name / format (e.g. HomeGauge, Spectora)",
  "minimumFindings": 10,
  "requiredCategories": ["Roof", "Electrical", "Plumbing"],
  "mustInclude": [
    {
      "category": "Roof",
      "descriptionContains": "shingle",
      "severity": "warning"
    }
  ],
  "mustNotInclude": [
    {
      "description": "Describes what a false positive looks like"
    }
  ],
  "propertyAddressContains": "Oceanside",
  "allowedTimeoutMs": 180000
}
```

## Current fixtures

| File | Format | Pages | Findings expected |
|------|--------|-------|-------------------|
| thomas-inspection.pdf | Unknown | 37 | ≥15 |

## Fixture naming convention

`{lastname}-inspection-{city}-{year}.pdf`
e.g. `thomas-inspection-scottsdale-2024.pdf`

## Why this matters

Every real PDF that fails in production becomes a permanent fixture here.
Parser fixes must pass ALL fixtures before shipping — not just the one that
triggered the fix.
