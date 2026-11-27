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


def test_top_five_blends_keyword_and_meaning():
    from raah import engine
    d = dataset.load()
    base = {"class": 10, "marks_pct": 60, "family_income_annual": 180000, "interests": ["helping people"]}
    plain = {s["career"]["id"]: s for s in engine.rank_careers(d, base, len(d["careers"]))}
    other = next(c["id"] for c in d["careers"] if plain[c["id"]]["fit"] == "none")
    scores = {c["id"]: 0.0 for c in d["careers"]}
    scores[other] = 1.0
    prof = {**base, "interest_meaning": {"for": ["helping people"], "scores": scores}}
    blended = {s["career"]["id"]: s for s in engine.rank_careers(d, prof, len(d["careers"]))}
    assert blended[other]["fit"] == "related" and blended[other]["breakdown"]["interest"] == 0.7
    assert "close in meaning" in blended[other]["why"]
    kw = next(i for i, s in plain.items() if s["fit"] == "direct")
    assert blended[kw]["breakdown"]["interest"] == round(0.3 * plain[kw]["breakdown"]["interest"], 2)
    # saved for different interests, or no model: the keyword ranking is used unchanged
    stale = {**prof, "interests": ["machines"]}
    assert [s["career"]["id"] for s in engine.rank_careers(d, stale)] == \
           [s["career"]["id"] for s in engine.rank_careers(d, {**base, "interests": ["machines"]})]


def test_ranking_numbers_come_from_the_assumptions_sheet():
    import copy
    from raah import engine
    d = dataset.load()
    for key in ("rank_w_interest", "rank_w_eligibility", "rank_w_affordability", "rank_w_demand", "rank_keyword_share",
                "elig_near_score", "afford_low_share", "ikigai_w_pays"):
        assert key in d["assumptions"], key
    prof = {"class": 10, "family_income_annual": 180000, "interests": ["helping people"]}
    base = engine.rank_careers(d, prof, 3)
    d2 = copy.deepcopy(d)
    d2["assumptions"]["rank_w_demand"]["value"] = 0.9  # demand now dominates the non-interest part
    changed = engine.rank_careers(d2, prof, 3)
    assert [s["score"] for s in changed] != [s["score"] for s in base]
    # weights are scaled to add up to 1, so a score stays between 0 and 1
    d2["assumptions"]["rank_w_interest"]["value"] = 5
    assert all(0 <= s["score"] <= 1 for s in engine.rank_careers(d2, prof, 10))
