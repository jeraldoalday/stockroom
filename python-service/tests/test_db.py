from contextlib import contextmanager

from app import db


class _FakeConnection:
    def __init__(self, raise_on_execute: bool = False):
        self.raise_on_execute = raise_on_execute
        self.executed: list = []

    def execute(self, statement):
        if self.raise_on_execute:
            raise RuntimeError("connection refused")
        self.executed.append(statement)


class _FakeEngine:
    def __init__(self, connection: _FakeConnection):
        self._connection = connection

    @contextmanager
    def connect(self):
        yield self._connection


def test_check_database_connection_true_when_select_1_succeeds(monkeypatch):
    fake_connection = _FakeConnection()
    monkeypatch.setattr(db, "get_engine", lambda: _FakeEngine(fake_connection))

    assert db.check_database_connection() is True
    assert len(fake_connection.executed) == 1


def test_check_database_connection_false_when_execute_raises(monkeypatch):
    fake_connection = _FakeConnection(raise_on_execute=True)
    monkeypatch.setattr(db, "get_engine", lambda: _FakeEngine(fake_connection))

    assert db.check_database_connection() is False


def test_get_db_yields_the_connection_from_get_connection(monkeypatch):
    fake_connection = _FakeConnection()
    monkeypatch.setattr(db, "get_engine", lambda: _FakeEngine(fake_connection))

    generator = db.get_db()
    try:
        assert next(generator) is fake_connection
    finally:
        generator.close()
