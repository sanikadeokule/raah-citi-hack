from raah import dataset, embed


def _fake(monkeypatch, vec_for):
    def fake(texts, kind="query"):
        return [vec_for(t) for t in texts], "fake:model"
    monkeypatch.setattr(embed, "embed", fake)
    embed._career_cache.clear()


def test_scores_scale_between_min_and_full(monkeypatch):
    d = dataset.load()
    first = d["careers"][0]
    # the query vector is the first career's own document, everything else is orthogonal-ish
    def vec(t):
        return [1.0, 0.0] if t == embed.career_doc(first) or t == "q" else [0.0, 1.0]
    _fake(monkeypatch, vec)
    out = embed.career_scores("q", d["careers"])
    assert out["method"] == "embedding"
    assert out["scores"][first["id"]] == 1.0
    assert all(v == 0.0 for k, v in out["scores"].items() if k != first["id"])


def test_nothing_close_gives_no_scores(monkeypatch):
    d = dataset.load()
    _fake(monkeypatch, lambda t: [1.0, 0.0] if t == "q" else [0.0, 1.0])
    assert embed.career_scores("q", d["careers"])["scores"] == {}


def test_no_model_means_keywords_only(monkeypatch):
    def boom(texts, kind="query"):
        raise embed.EmbedUnavailable("none")
    monkeypatch.setattr(embed, "embed", boom)
    out = embed.career_scores("nursing", dataset.load()["careers"])
    assert out == {"method": "keyword", "scores": {}}
    assert embed.career_scores("  ", dataset.load()["careers"])["method"] == "none"
