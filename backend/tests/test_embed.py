"""Free-text interests map to the spreadsheet's tags by embedding, or by keywords without a model."""
from fastapi.testclient import TestClient

from raah import dataset, embed
from raah.main import app

c = TestClient(app)
TAGS = embed.all_tags(dataset.get())


def fake_provider(concepts):
    """Embeds text as a vector over a few concepts, so a Marathi sentence can land near an English tag."""
    def fn(texts, kind):
        return [[1.0 if any(w in t.lower() for w in words) else 0.0 for words in concepts.values()] + [0.01] for t in texts], "fake"
    return fn


def test_marathi_sentence_matches_english_tag(monkeypatch):
    target = TAGS[0]
    monkeypatch.setenv("EMBED_PROVIDERS", "fake")
    monkeypatch.setitem(embed.PROVIDERS, "fake", fake_provider({"a": [target.lower(), "गाड्या"]}))
    embed._tag_cache.clear()
    r = c.post("/api/interests/match", json={"text": "मला गाड्या दुरुस्त करायला आवडतं"}).json()
    assert r["method"] == "embedding" and r["tags"][0]["tag"] == target


def test_tag_edit_in_spreadsheet_re_embeds(monkeypatch):
    calls = []
    monkeypatch.setenv("EMBED_PROVIDERS", "fake")
    monkeypatch.setitem(embed.PROVIDERS, "fake", lambda texts, kind: (calls.append(kind), ([[1.0, 0.0]] * len(texts), "fake"))[1])
    embed._tag_cache.clear()
    embed.match("x", ["a", "b"])
    embed.match("y", ["a", "b"])
    embed.match("z", ["a", "b", "c"])
    assert calls.count("passage") == 2 and calls.count("query") == 3


def test_keyword_fallback_without_any_model(monkeypatch):
    monkeypatch.setenv("EMBED_PROVIDERS", "")
    tag = next(t for t in TAGS if " " not in t)
    r = c.post("/api/interests/match", json={"text": f"I really like {tag} a lot"}).json()
    assert r["method"] == "keyword" and r["tags"][0]["tag"] == tag
