"""Offline tests for the Mac launcher and the Python Supabase transport."""

import contextlib
import fcntl
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import refresh
import refresh_macos

PROJECT_URL = "https://fixture.supabase.co"
FIXTURE_KEY = "sb_secret_offline_fixture"


class MacLauncherTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.config = Path(self.temporary.name)
        (self.config / "project-url").write_text(PROJECT_URL + "\n")
        (self.config / "project-url").chmod(0o600)
        self.capture = io.StringIO()
        self.enterContext(contextlib.redirect_stderr(self.capture))
        self.enterContext(contextlib.redirect_stdout(self.capture))

    def test_keychain_command_returns_key_without_output(self):
        result = subprocess.CompletedProcess([], 0, stdout=FIXTURE_KEY + "\n")
        with patch.object(refresh_macos.subprocess, "run", return_value=result) as invoke:
            self.assertTrue(refresh_macos.read_keychain_key() == FIXTURE_KEY)
        command = invoke.call_args.args[0]
        self.assertEqual(command[:3], ["/usr/bin/security", "find-generic-password", "-w"])
        self.assertIn(refresh_macos.KEYCHAIN_SERVICE, command)
        self.assertTrue(command[-1].endswith("/Library/Keychains/login.keychain-db"))
        self.assertEqual(invoke.call_args.kwargs["timeout"], 10)
        self.assertFalse(FIXTURE_KEY in self.capture.getvalue())

    def test_missing_locked_or_legacy_key_never_runs_refresh(self):
        outcomes = [
            subprocess.CalledProcessError(1, [], output=FIXTURE_KEY),
            subprocess.TimeoutExpired([], 10, output=FIXTURE_KEY),
            subprocess.CompletedProcess([], 0, stdout="fixture-legacy-format"),
        ]
        with patch.object(refresh, "main") as run:
            for outcome in outcomes:
                with self.subTest(kind=type(outcome).__name__):
                    stub = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
                    with patch.object(refresh_macos.subprocess, "run", **stub):
                        self.assertEqual(refresh_macos.launch(self.config, False), 1)
            run.assert_not_called()
        self.assertFalse(FIXTURE_KEY in self.capture.getvalue())

    def test_preflight_checks_local_configuration_without_refresh(self):
        with patch.object(refresh_macos, "read_keychain_key", return_value=FIXTURE_KEY):
            with patch.object(refresh, "main") as run:
                self.assertEqual(refresh_macos.launch(self.config, True), 0)
                run.assert_not_called()
        self.assertFalse(FIXTURE_KEY in self.capture.getvalue())

    def test_launcher_injects_only_designated_credentials_and_calls_logs_mode(self):
        with patch.dict(os.environ, {"SUPABASE_REFRESH_API_KEY": "fixture-stale"}, clear=True):
            with patch.object(refresh_macos, "read_keychain_key", return_value=FIXTURE_KEY):
                with patch.object(refresh, "main") as run:
                    self.assertEqual(refresh_macos.launch(self.config, False), 0)
                    run.assert_called_once_with(game_logs_only=True)
                    self.assertTrue(os.environ["SUPABASE_REFRESH_API_KEY"] == FIXTURE_KEY)
                    self.assertEqual(os.environ["SUPABASE_URL"], PROJECT_URL)

    def test_overlap_and_untrusted_config_fail_before_keychain_lookup(self):
        with patch.object(refresh_macos, "read_keychain_key") as lookup:
            with (self.config / "nba-refresh.lock").open("w") as other_run:
                fcntl.flock(other_run, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertEqual(refresh_macos.launch(self.config, False), 1)
            (self.config / "project-url").chmod(0o644)
            self.assertEqual(refresh_macos.launch(self.config, False), 1)
            lookup.assert_not_called()

    def test_refresh_failure_is_nonzero_and_sanitized(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(refresh_macos, "read_keychain_key", return_value=FIXTURE_KEY):
                with patch.object(refresh, "main", side_effect=RuntimeError(FIXTURE_KEY)):
                    self.assertEqual(refresh_macos.launch(self.config, False), 1)
        self.assertFalse(FIXTURE_KEY in self.capture.getvalue())

    def test_shell_uses_repo_venv_and_propagates_exit_code(self):
        repo = self.config / "checkout with spaces"
        scripts = repo / "scripts"
        scripts.mkdir(parents=True)
        entry = scripts / "run_refresh.sh"
        shutil.copyfile(ROOT / "scripts/run_refresh.sh", entry)
        cmd = ["/bin/bash", str(entry), "--check-config"]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=self.config)
        self.assertEqual(result.returncode, 1)
        python = repo / ".venv/bin/python"
        python.parent.mkdir(parents=True)
        python.write_text('#!/bin/bash\nprintf "%s\\n" "$@"\nexit 23\n')
        python.chmod(0o700)
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=self.config)
        self.assertEqual(result.returncode, 23)
        self.assertEqual(result.stdout.splitlines(), ["-E", "-s", str(scripts.resolve() / "refresh_macos.py"), "--check-config"])


class RefreshTransportTest(unittest.TestCase):
    def test_real_sdk_sends_modern_apikey_without_bearer(self):
        sent = []
        client = httpx.Client

        def respond(request):
            sent.append(request)
            return httpx.Response(200, json=[{"id": 1}])

        def mock_client(**options):
            return client(transport=httpx.MockTransport(respond), **options)

        with patch.dict(os.environ, {"SUPABASE_URL": PROJECT_URL, "SUPABASE_REFRESH_API_KEY": FIXTURE_KEY}, clear=True):
            with patch.object(refresh.httpx, "Client", side_effect=mock_client):
                db = refresh.get_supabase_client()
                self.assertEqual(db.table("refresh_status").select("id").execute().data, [{"id": 1}])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0].url.path, "/rest/v1/refresh_status")
        self.assertTrue(sent[0].headers.get("apikey") == FIXTURE_KEY)
        self.assertNotIn("authorization", sent[0].headers)

    def test_legacy_key_or_invalid_origin_never_constructs_client(self):
        with patch.object(refresh, "create_client") as make_client:
            for url, key in [(PROJECT_URL, "fixture-legacy"), ("http://fixture.invalid", FIXTURE_KEY)]:
                with patch.dict(os.environ, {"SUPABASE_URL": url, "SUPABASE_REFRESH_API_KEY": key}, clear=True):
                    with self.assertRaises(SystemExit):
                        refresh.get_supabase_client()
            make_client.assert_not_called()

    def test_game_logs_mode_leaves_slate_and_scoring_to_hosted_pipeline(self):
        row = {"game_date": "2026-04-19", "team_abbr": "BOS"}
        with contextlib.redirect_stdout(io.StringIO()):
            with contextlib.ExitStack() as stack:
                stubs = {
                    "get_supabase_client": MagicMock(),
                    "fetch_player_game_logs": [row],
                    "fetch_team_game_logs": [row],
                    "filter_postseason_player_games": [row],
                    "filter_postseason_team_games": [row],
                    "calculate_streaks": [{"sport": "NBA"}],
                    "calculate_team_streaks": [],
                    "detect_streak_events": [],
                    "insert_streak_events": None,
                    "fetch_todays_games": [],
                    "trigger_scoring_engine": None,
                    "upsert_data": None,
                    "update_refresh_status": None,
                }
                calls = {name: stack.enter_context(patch.object(refresh, name, return_value=value))
                         for name, value in stubs.items()}
                refresh.main(game_logs_only=True)
        calls["fetch_todays_games"].assert_not_called()
        calls["trigger_scoring_engine"].assert_not_called()
        self.assertEqual([call.args[1] for call in calls["upsert_data"].call_args_list],
                         ["player_recent_games", "team_recent_games", "streaks"])
        self.assertEqual(calls["update_refresh_status"].call_args.args[1], 1)

    def test_team_provider_failure_does_not_mutate_database(self):
        row = {"game_date": "2026-04-19", "team_abbr": "BOS"}
        with contextlib.redirect_stdout(io.StringIO()), contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(refresh, "get_supabase_client"))
            stack.enter_context(patch.object(refresh, "fetch_player_game_logs", return_value=[row]))
            stack.enter_context(patch.object(refresh, "fetch_team_game_logs", return_value=[]))
            writes = stack.enter_context(patch.object(refresh, "upsert_data"))
            stamp = stack.enter_context(patch.object(refresh, "update_refresh_status"))
            with self.assertRaises(SystemExit):
                refresh.main(game_logs_only=True)
        writes.assert_not_called()
        stamp.assert_not_called()


if __name__ == "__main__":
    unittest.main()
