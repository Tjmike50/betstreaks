

# Fix NBA Season Start Date

## The Issue

The current `get_season_start_date()` function uses **October 22** as the season start date, but the 2025-26 NBA season actually started on **Tuesday, October 21, 2025**.

## The Fix

Update `scripts/refresh.py` line 50-58 to use October 21 instead of October 22:

| Line | Current | Updated |
|------|---------|---------|
| 51 | `"""Get the start date of the current NBA season (Oct 22)."""` | `"""Get the start date of the current NBA season (Oct 21)."""` |
| 55 | `return datetime(now.year, 10, 22)` | `return datetime(now.year, 10, 21)` |
| 58 | `return datetime(now.year - 1, 10, 22)` | `return datetime(now.year - 1, 10, 21)` |

## Updated Code

```python
def get_season_start_date() -> datetime:
    """Get the start date of the current NBA season (Oct 21)."""
    now = datetime.now()
    if now.month >= 10:
        # Season started this year (Oct 21)
        return datetime(now.year, 10, 21)
    else:
        # Season started last year (Oct 21)
        return datetime(now.year - 1, 10, 21)
```

## After Implementation

Re-run the GitHub Actions workflow to fetch data from the correct season start date (October 21, 2025).

