#!/usr/bin/env python3
"""
NBA Data Refresh Script for GitHub Actions
Fetches player stats, team stats, and game data from nba_api and upserts to Supabase.
"""

import os
import sys
from datetime import datetime
from typing import Optional
import time

from nba_api.stats.endpoints import (
    ScoreboardV2,
    PlayerGameLogs,
    TeamGameLogs,
)
from nba_api.stats.static import teams
from supabase import create_client, Client

# Configuration - Player stat thresholds
STAT_COLUMNS = {
    "PTS": "pts",
    "REB": "reb",
    "AST": "ast",
    "3PM": "fg3m",
    "BLK": "blk",
    "STL": "stl",
}

STAT_THRESHOLDS = {
    "PTS": [10, 15, 20, 25, 30, 35, 40, 45, 50],
    "REB": [5, 8, 10, 12, 15, 18, 20],
    "AST": [3, 5, 8, 10, 12],
    "3PM": [1, 2, 3, 4, 5, 6],
    "BLK": [1, 2, 3, 4, 5],
    "STL": [1, 2, 3, 4],
}

# Configuration - Team stat thresholds
TEAM_STAT_THRESHOLDS = {
    "ML": [1],  # Moneyline (win detection)
    "PTS": [100, 105, 110, 115, 120, 125, 130],  # Team points over
    "PTS_U": [100, 105, 110, 115, 120, 125],  # Team points under
}

MIN_STREAK_LENGTH = 3


def get_season_start_date() -> datetime:
    """Get the start date of the current NBA season (Oct 22)."""
    now = datetime.now()
    if now.month >= 10:
        # Season started this year (Oct 22)
        return datetime(now.year, 10, 22)
    else:
        # Season started last year (Oct 22)
        return datetime(now.year - 1, 10, 22)


def get_season_string() -> str:
    """Get the current season string (e.g., '2024-25')."""
    now = datetime.now()
    if now.month >= 10:
        return f"{now.year}-{str(now.year + 1)[2:]}"
    else:
        return f"{now.year - 1}-{str(now.year)[2:]}"


def get_supabase_client() -> Client:
    """Initialize Supabase client from environment variables."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        sys.exit(1)
    
    return create_client(url, key)


def fetch_todays_games() -> list[dict]:
    """Fetch today's NBA scoreboard."""
    print("Fetching today's games...")
    
    try:
        scoreboard = ScoreboardV2()
        games_df = scoreboard.get_data_frames()[0]
        
        games = []
        for _, row in games_df.iterrows():
            game_id = str(row["GAME_ID"])
            
            # Parse game time
            game_date_str = row.get("GAME_DATE_EST", "")
            if game_date_str:
                game_date = datetime.strptime(game_date_str[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
            else:
                game_date = datetime.now().strftime("%Y-%m-%d")
            
            # Get status
            status = row.get("GAME_STATUS_TEXT", "")
            
            games.append({
                "id": game_id,
                "home_team_abbr": row.get("HOME_TEAM_ABBREVIATION"),
                "away_team_abbr": row.get("VISITOR_TEAM_ABBREVIATION"),
                "home_score": int(row["HOME_TEAM_PTS"]) if row.get("HOME_TEAM_PTS") else None,
                "away_score": int(row["VISITOR_TEAM_PTS"]) if row.get("VISITOR_TEAM_PTS") else None,
                "status": status,
                "game_date": game_date,
                "game_time": status if "ET" in str(status) else None,
                "sport": "NBA",
            })
        
        print(f"Found {len(games)} games today")
        return games
    
    except Exception as e:
        print(f"Error fetching games: {e}")
        return []


def fetch_player_game_logs() -> list[dict]:
    """Fetch player game logs for the entire season."""
    season_start = get_season_start_date()
    season = get_season_string()
    now = datetime.now()
    
    date_from = season_start.strftime("%m/%d/%Y")
    date_to = now.strftime("%m/%d/%Y")
    
    print(f"Fetching player game logs for {season} season ({date_from} to {date_to})...")
    
    try:
        # Add delay to avoid rate limiting
        time.sleep(1)
        
        logs = PlayerGameLogs(
            season_nullable=season,
            date_from_nullable=date_from,
            date_to_nullable=date_to,
        )
        df = logs.get_data_frames()[0]
        
        games = []
        for _, row in df.iterrows():
            game_date = datetime.strptime(row["GAME_DATE"], "%Y-%m-%dT%H:%M:%S").strftime("%Y-%m-%d")
            
            games.append({
                "player_id": int(row["PLAYER_ID"]),
                "player_name": row["PLAYER_NAME"],
                "team_abbr": row["TEAM_ABBREVIATION"],
                "game_id": str(row["GAME_ID"]),
                "game_date": game_date,
                "matchup": row.get("MATCHUP"),
                "wl": row.get("WL"),
                "pts": int(row["PTS"]) if row.get("PTS") is not None else None,
                "reb": int(row["REB"]) if row.get("REB") is not None else None,
                "ast": int(row["AST"]) if row.get("AST") is not None else None,
                "fg3m": int(row["FG3M"]) if row.get("FG3M") is not None else None,
                "blk": int(row["BLK"]) if row.get("BLK") is not None else None,
                "stl": int(row["STL"]) if row.get("STL") is not None else None,
                "sport": "NBA",
            })
        
        print(f"Found {len(games)} player game records")
        return games
    
    except Exception as e:
        print(f"Error fetching player logs: {e}")
        return []


def fetch_team_game_logs() -> list[dict]:
    """Fetch team game logs for the entire season."""
    season_start = get_season_start_date()
    season = get_season_string()
    now = datetime.now()
    
    date_from = season_start.strftime("%m/%d/%Y")
    date_to = now.strftime("%m/%d/%Y")
    
    print(f"Fetching team game logs for {season} season ({date_from} to {date_to})...")
    
    try:
        # Add delay to avoid rate limiting
        time.sleep(1)
        
        logs = TeamGameLogs(
            season_nullable=season,
            date_from_nullable=date_from,
            date_to_nullable=date_to,
        )
        df = logs.get_data_frames()[0]
        
        games = []
        for _, row in df.iterrows():
            game_date = datetime.strptime(row["GAME_DATE"], "%Y-%m-%dT%H:%M:%S").strftime("%Y-%m-%d")
            
            games.append({
                "team_id": int(row["TEAM_ID"]),
                "team_abbr": row["TEAM_ABBREVIATION"],
                "game_id": str(row["GAME_ID"]),
                "game_date": game_date,
                "matchup": row.get("MATCHUP"),
                "wl": row.get("WL"),
                "pts": int(row["PTS"]) if row.get("PTS") is not None else None,
                "sport": "NBA",
            })
        
        print(f"Found {len(games)} team game records")
        return games
    
    except Exception as e:
        print(f"Error fetching team logs: {e}")
        return []


def calculate_streaks(player_games: list[dict]) -> list[dict]:
    """Calculate player streaks for each player/stat/threshold combination."""
    print("Calculating player streaks...")
    
    # Group games by player
    player_data = {}
    for game in player_games:
        pid = game["player_id"]
        if pid not in player_data:
            player_data[pid] = {
                "player_name": game["player_name"],
                "team_abbr": game["team_abbr"],
                "games": [],
            }
        player_data[pid]["games"].append(game)
    
    # Sort each player's games by date (most recent first)
    for pid in player_data:
        player_data[pid]["games"].sort(key=lambda g: g["game_date"], reverse=True)
    
    streaks = []
    
    for pid, data in player_data.items():
        games = data["games"]
        if not games:
            continue
        
        for stat_name, col_name in STAT_COLUMNS.items():
            thresholds = STAT_THRESHOLDS.get(stat_name, [])
            
            for threshold in thresholds:
                # Calculate streak
                streak_len = 0
                streak_start = None
                
                for game in games:
                    val = game.get(col_name)
                    if val is not None and val >= threshold:
                        streak_len += 1
                        streak_start = game["game_date"]
                    else:
                        break
                
                if streak_len < MIN_STREAK_LENGTH:
                    continue
                
                # Calculate season stats
                season_wins = sum(1 for g in games if (g.get(col_name) or 0) >= threshold)
                season_games = len(games)
                season_win_pct = round((season_wins / season_games * 100), 1) if season_games > 0 else 0
                
                # Calculate L5, L10, L15, L20 stats
                last5 = games[:5]
                last5_hits = sum(1 for g in last5 if (g.get(col_name) or 0) >= threshold)
                last5_games = len(last5)
                last5_hit_pct = round((last5_hits / last5_games * 100), 1) if last5_games > 0 else None
                
                last10 = games[:10]
                last10_hits = sum(1 for g in last10 if (g.get(col_name) or 0) >= threshold)
                last10_games = len(last10)
                last10_hit_pct = round((last10_hits / last10_games * 100), 1) if last10_games > 0 else None
                
                last15 = games[:15]
                last15_hits = sum(1 for g in last15 if (g.get(col_name) or 0) >= threshold)
                last15_games = len(last15)
                last15_hit_pct = round((last15_hits / last15_games * 100), 1) if last15_games > 0 else None
                
                last20 = games[:20]
                last20_hits = sum(1 for g in last20 if (g.get(col_name) or 0) >= threshold)
                last20_games = len(last20)
                last20_hit_pct = round((last20_hits / last20_games * 100), 1) if last20_games > 0 else None
                
                streaks.append({
                    "player_id": pid,
                    "player_name": data["player_name"],
                    "team_abbr": data["team_abbr"],
                    "stat": stat_name,
                    "threshold": threshold,
                    "streak_len": streak_len,
                    "streak_start": streak_start,
                    "streak_win_pct": 100.0,  # Current streak is 100% by definition
                    "season_wins": season_wins,
                    "season_games": season_games,
                    "season_win_pct": season_win_pct,
                    "last_game": games[0]["game_date"],
                    "last5_hits": last5_hits,
                    "last5_games": last5_games,
                    "last5_hit_pct": last5_hit_pct,
                    "last10_hits": last10_hits,
                    "last10_games": last10_games,
                    "last10_hit_pct": last10_hit_pct,
                    "last15_hits": last15_hits,
                    "last15_games": last15_games,
                    "last15_hit_pct": last15_hit_pct,
                    "last20_hits": last20_hits,
                    "last20_games": last20_games,
                    "last20_hit_pct": last20_hit_pct,
                    "sport": "NBA",
                    "entity_type": "player",
                })
    
    print(f"Found {len(streaks)} active player streaks")
    return streaks


def calculate_team_streaks(team_games: list[dict]) -> list[dict]:
    """Calculate team streaks for each team/stat/threshold combination."""
    print("Calculating team streaks...")
    
    # Get team name mapping
    nba_teams = {t["abbreviation"]: t["full_name"] for t in teams.get_teams()}
    
    # Group games by team
    team_data = {}
    for game in team_games:
        tid = game["team_id"]
        if tid not in team_data:
            team_abbr = game["team_abbr"]
            team_data[tid] = {
                "team_name": nba_teams.get(team_abbr, team_abbr),
                "team_abbr": team_abbr,
                "games": [],
            }
        team_data[tid]["games"].append(game)
    
    # Sort each team's games by date (most recent first)
    for tid in team_data:
        team_data[tid]["games"].sort(key=lambda g: g["game_date"], reverse=True)
    
    streaks = []
    
    for tid, data in team_data.items():
        games = data["games"]
        if not games:
            continue
        
        # Process ML (Moneyline - consecutive wins)
        ml_streak_len = 0
        ml_streak_start = None
        for game in games:
            if game.get("wl") == "W":
                ml_streak_len += 1
                ml_streak_start = game["game_date"]
            else:
                break
        
        if ml_streak_len >= MIN_STREAK_LENGTH:
            season_wins = sum(1 for g in games if g.get("wl") == "W")
            season_games = len(games)
            season_win_pct = round((season_wins / season_games * 100), 1) if season_games > 0 else 0
            
            # L5, L10, L15, L20 for ML
            last5 = games[:5]
            last5_hits = sum(1 for g in last5 if g.get("wl") == "W")
            last10 = games[:10]
            last10_hits = sum(1 for g in last10 if g.get("wl") == "W")
            last15 = games[:15]
            last15_hits = sum(1 for g in last15 if g.get("wl") == "W")
            last20 = games[:20]
            last20_hits = sum(1 for g in last20 if g.get("wl") == "W")
            
            streaks.append({
                "player_id": 0,  # Not applicable for teams
                "player_name": data["team_name"],
                "team_abbr": data["team_abbr"],
                "stat": "ML",
                "threshold": 1,
                "streak_len": ml_streak_len,
                "streak_start": ml_streak_start,
                "streak_win_pct": 100.0,
                "season_wins": season_wins,
                "season_games": season_games,
                "season_win_pct": season_win_pct,
                "last_game": games[0]["game_date"],
                "last5_hits": last5_hits,
                "last5_games": len(last5),
                "last5_hit_pct": round((last5_hits / len(last5) * 100), 1) if last5 else None,
                "last10_hits": last10_hits,
                "last10_games": len(last10),
                "last10_hit_pct": round((last10_hits / len(last10) * 100), 1) if last10 else None,
                "last15_hits": last15_hits,
                "last15_games": len(last15),
                "last15_hit_pct": round((last15_hits / len(last15) * 100), 1) if last15 else None,
                "last20_hits": last20_hits,
                "last20_games": len(last20),
                "last20_hit_pct": round((last20_hits / len(last20) * 100), 1) if last20 else None,
                "sport": "NBA",
                "entity_type": "team",
            })
        
        # Process PTS (Team Points Over)
        for threshold in TEAM_STAT_THRESHOLDS["PTS"]:
            streak_len = 0
            streak_start = None
            
            for game in games:
                pts = game.get("pts")
                if pts is not None and pts >= threshold:
                    streak_len += 1
                    streak_start = game["game_date"]
                else:
                    break
            
            if streak_len < MIN_STREAK_LENGTH:
                continue
            
            season_wins = sum(1 for g in games if (g.get("pts") or 0) >= threshold)
            season_games = len(games)
            season_win_pct = round((season_wins / season_games * 100), 1) if season_games > 0 else 0
            
            last5 = games[:5]
            last5_hits = sum(1 for g in last5 if (g.get("pts") or 0) >= threshold)
            last10 = games[:10]
            last10_hits = sum(1 for g in last10 if (g.get("pts") or 0) >= threshold)
            last15 = games[:15]
            last15_hits = sum(1 for g in last15 if (g.get("pts") or 0) >= threshold)
            last20 = games[:20]
            last20_hits = sum(1 for g in last20 if (g.get("pts") or 0) >= threshold)
            
            streaks.append({
                "player_id": 0,
                "player_name": data["team_name"],
                "team_abbr": data["team_abbr"],
                "stat": "PTS",
                "threshold": threshold,
                "streak_len": streak_len,
                "streak_start": streak_start,
                "streak_win_pct": 100.0,
                "season_wins": season_wins,
                "season_games": season_games,
                "season_win_pct": season_win_pct,
                "last_game": games[0]["game_date"],
                "last5_hits": last5_hits,
                "last5_games": len(last5),
                "last5_hit_pct": round((last5_hits / len(last5) * 100), 1) if last5 else None,
                "last10_hits": last10_hits,
                "last10_games": len(last10),
                "last10_hit_pct": round((last10_hits / len(last10) * 100), 1) if last10 else None,
                "last15_hits": last15_hits,
                "last15_games": len(last15),
                "last15_hit_pct": round((last15_hits / len(last15) * 100), 1) if last15 else None,
                "last20_hits": last20_hits,
                "last20_games": len(last20),
                "last20_hit_pct": round((last20_hits / len(last20) * 100), 1) if last20 else None,
                "sport": "NBA",
                "entity_type": "team",
            })
        
        # Process PTS_U (Team Points Under)
        for threshold in TEAM_STAT_THRESHOLDS["PTS_U"]:
            streak_len = 0
            streak_start = None
            
            for game in games:
                pts = game.get("pts")
                if pts is not None and pts <= threshold:
                    streak_len += 1
                    streak_start = game["game_date"]
                else:
                    break
            
            if streak_len < MIN_STREAK_LENGTH:
                continue
            
            season_wins = sum(1 for g in games if (g.get("pts") or 0) <= threshold)
            season_games = len(games)
            season_win_pct = round((season_wins / season_games * 100), 1) if season_games > 0 else 0
            
            last5 = games[:5]
            last5_hits = sum(1 for g in last5 if (g.get("pts") or 0) <= threshold)
            last10 = games[:10]
            last10_hits = sum(1 for g in last10 if (g.get("pts") or 0) <= threshold)
            last15 = games[:15]
            last15_hits = sum(1 for g in last15 if (g.get("pts") or 0) <= threshold)
            last20 = games[:20]
            last20_hits = sum(1 for g in last20 if (g.get("pts") or 0) <= threshold)
            
            streaks.append({
                "player_id": 0,
                "player_name": data["team_name"],
                "team_abbr": data["team_abbr"],
                "stat": "PTS_U",
                "threshold": threshold,
                "streak_len": streak_len,
                "streak_start": streak_start,
                "streak_win_pct": 100.0,
                "season_wins": season_wins,
                "season_games": season_games,
                "season_win_pct": season_win_pct,
                "last_game": games[0]["game_date"],
                "last5_hits": last5_hits,
                "last5_games": len(last5),
                "last5_hit_pct": round((last5_hits / len(last5) * 100), 1) if last5 else None,
                "last10_hits": last10_hits,
                "last10_games": len(last10),
                "last10_hit_pct": round((last10_hits / len(last10) * 100), 1) if last10 else None,
                "last15_hits": last15_hits,
                "last15_games": len(last15),
                "last15_hit_pct": round((last15_hits / len(last15) * 100), 1) if last15 else None,
                "last20_hits": last20_hits,
                "last20_games": len(last20),
                "last20_hit_pct": round((last20_hits / len(last20) * 100), 1) if last20 else None,
                "sport": "NBA",
                "entity_type": "team",
            })
    
    print(f"Found {len(streaks)} active team streaks")
    return streaks


def detect_streak_events(
    supabase: Client,
    new_streaks: list[dict],
) -> list[dict]:
    """Compare new streaks with existing ones to detect started/extended/broken events."""
    print("Detecting streak events...")
    
    # Fetch existing streaks
    result = supabase.table("streaks").select("*").eq("sport", "NBA").execute()
    
    # Create keys based on entity type
    old_streaks = {}
    for s in result.data:
        if s["entity_type"] == "team":
            key = (s["team_abbr"], s["stat"], s["threshold"], "team")
        else:
            key = (s["player_id"], s["stat"], s["threshold"], "player")
        old_streaks[key] = s
    
    new_streaks_map = {}
    for s in new_streaks:
        if s["entity_type"] == "team":
            key = (s["team_abbr"], s["stat"], s["threshold"], "team")
        else:
            key = (s["player_id"], s["stat"], s["threshold"], "player")
        new_streaks_map[key] = s
    
    events = []
    
    # Check for new/extended streaks
    for key, new_s in new_streaks_map.items():
        old_s = old_streaks.get(key)
        
        if old_s is None:
            # New streak started
            events.append({
                "player_id": new_s["player_id"],
                "player_name": new_s["player_name"],
                "team_abbr": new_s["team_abbr"],
                "stat": new_s["stat"],
                "threshold": new_s["threshold"],
                "event_type": "started",
                "prev_streak_len": 0,
                "new_streak_len": new_s["streak_len"],
                "last_game": new_s["last_game"],
                "entity_type": new_s["entity_type"],
                "sport": "NBA",
            })
        elif new_s["streak_len"] > old_s["streak_len"]:
            # Streak extended
            events.append({
                "player_id": new_s["player_id"],
                "player_name": new_s["player_name"],
                "team_abbr": new_s["team_abbr"],
                "stat": new_s["stat"],
                "threshold": new_s["threshold"],
                "event_type": "extended",
                "prev_streak_len": old_s["streak_len"],
                "new_streak_len": new_s["streak_len"],
                "last_game": new_s["last_game"],
                "entity_type": new_s["entity_type"],
                "sport": "NBA",
            })
    
    # Check for broken streaks
    for key, old_s in old_streaks.items():
        if key not in new_streaks_map:
            events.append({
                "player_id": old_s["player_id"],
                "player_name": old_s["player_name"],
                "team_abbr": old_s["team_abbr"],
                "stat": old_s["stat"],
                "threshold": old_s["threshold"],
                "event_type": "broken",
                "prev_streak_len": old_s["streak_len"],
                "new_streak_len": 0,
                "last_game": old_s["last_game"],
                "entity_type": old_s["entity_type"],
                "sport": "NBA",
            })
    
    print(f"Detected {len(events)} streak events")
    return events


def upsert_data(supabase: Client, table: str, data: list[dict], conflict_cols: Optional[list[str]] = None):
    """Upsert data to a Supabase table."""
    if not data:
        print(f"No data to upsert to {table}")
        return
    
    print(f"Upserting {len(data)} records to {table}...")
    
    # Add updated_at timestamp
    now = datetime.now().isoformat()
    for record in data:
        record["updated_at"] = now
    
    # Batch upsert in chunks
    chunk_size = 500
    for i in range(0, len(data), chunk_size):
        chunk = data[i:i + chunk_size]
        
        if conflict_cols:
            supabase.table(table).upsert(chunk, on_conflict=",".join(conflict_cols)).execute()
        else:
            supabase.table(table).upsert(chunk).execute()
    
    print(f"Successfully upserted to {table}")


def update_refresh_status(supabase: Client, refresh_id: int):
    """Update the refresh_status table."""
    supabase.table("refresh_status").upsert({
        "id": refresh_id,
        "sport": "NBA",
        "last_run": datetime.now().isoformat(),
    }, on_conflict="id").execute()
    print(f"Updated refresh_status id={refresh_id}")


def main():
    """Main entry point."""
    start_time = datetime.now()
    print(f"=== NBA Data Refresh Started at {start_time.isoformat()} ===\n")
    print(f"Season: {get_season_string()}")
    print(f"Season start: {get_season_start_date().strftime('%Y-%m-%d')}\n")
    
    supabase = get_supabase_client()
    
    # 1. Fetch and upsert today's games
    games = fetch_todays_games()
    if games:
        upsert_data(supabase, "games_today", games)
    update_refresh_status(supabase, 2)  # id=2 for games
    
    print()
    
    # 2. Fetch player game logs
    player_games = fetch_player_game_logs()
    if player_games:
        upsert_data(supabase, "player_recent_games", player_games, ["player_id", "game_id"])
    
    print()
    
    # 3. Fetch team game logs
    team_games = fetch_team_game_logs()
    if team_games:
        upsert_data(supabase, "team_recent_games", team_games, ["team_id", "game_id"])
    
    print()
    
    # 4. Calculate player streaks
    player_streaks = calculate_streaks(player_games)
    
    # 5. Calculate team streaks
    team_streaks = calculate_team_streaks(team_games)
    
    # 6. Combine all streaks
    all_streaks = player_streaks + team_streaks
    
    # 7. Detect streak events
    events = detect_streak_events(supabase, all_streaks)
    if events:
        # Insert events (don't upsert, we want history)
        for event in events:
            event["created_at"] = datetime.now().isoformat()
        supabase.table("streak_events").insert(events).execute()
        print(f"Inserted {len(events)} streak events")
    
    # 8. Replace streaks table (delete old, insert new)
    print("Replacing streaks table...")
    supabase.table("streaks").delete().eq("sport", "NBA").execute()
    if all_streaks:
        upsert_data(supabase, "streaks", all_streaks)
    
    # 9. Update refresh status
    update_refresh_status(supabase, 1)  # id=1 for players/streaks
    
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    
    print(f"\n=== Refresh Complete in {duration:.1f}s ===")
    print(f"Games today: {len(games)}")
    print(f"Player game records: {len(player_games)}")
    print(f"Team game records: {len(team_games)}")
    print(f"Player streaks: {len(player_streaks)}")
    print(f"Team streaks: {len(team_streaks)}")
    print(f"Streak events: {len(events)}")


if __name__ == "__main__":
    main()
