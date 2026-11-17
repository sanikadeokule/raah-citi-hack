"""Career ranking follows the student's interests; the scholarship check says what a plan changes."""
from raah import dataset, engine

BASE = {"class": 10, "family_income_annual": 120000}


def names(top):
    return [s["career"]["name"] for s in top]


def career_with_tag(d, tag):
    return [c["name"] for c in d["careers"] if tag in (c.get("tags") or [])]


def test_computers_interest_ranks_only_linked_careers():
    d = dataset.load()
    direct = career_with_tag(d, "computers")
    # the dataset now has more than 5 'computers' careers, so the top 5 are all direct matches
    top = engine.rank_careers(d, {**BASE, "interests": ["computers"]})
    assert set(names(top)) <= set(direct) and all(s["fit"] == "direct" for s in top)
    # asked for the whole list, every career tagged 'computers' comes first, and nothing unlinked fills it
    top = engine.rank_careers(d, {**BASE, "interests": ["computers"]}, len(direct) + 3)
    assert set(names(top[:len(direct)])) == set(direct)
    assert all(s["fit"] in ("direct", "related") for s in top)
    assert "Beautician / salon" not in names(top)
    for s in top[len(direct):]:
        assert s["related"] and "close to your interests" in s["why"]


def test_plural_and_singular_match():
    d = dataset.load()
    a = names(engine.rank_careers(d, {**BASE, "interests": ["computers"]}))
    b = names(engine.rank_careers(d, {**BASE, "interests": ["computer"]}))
    assert a == b


def test_shared_word_is_not_a_match():
    d = dataset.load()
    # 'helping people' must not match 'talking to people' just through the word 'people'
    top = engine.rank_careers(d, {**BASE, "interests": ["helping people"]})
    for s in top:
        tags = [t.lower() for t in s["career"]["tags"]]
        assert s["fit"] != "direct" or "helping people" in tags, s["career"]["name"]


def test_direct_matches_always_outrank_unlinked():
    d = dataset.load()
    for interests in (["computers"], ["beauty"], ["helping people", "biology"], ["animals"]):
        top = engine.rank_careers(d, {**BASE, "interests": interests}, len(d["careers"]))
        tiers = [{"direct": 0, "related": 1, "none": 2}[s["fit"]] for s in top]
        assert tiers == sorted(tiers), interests


def test_unlinked_career_is_never_called_a_fit():
    d = dataset.load()
    for s in engine.rank_careers(d, {**BASE, "interests": ["animals"]}, len(d["careers"])):
        if s["fit"] == "none":
            assert s["why"].startswith("A different kind of path"), s["why"]


def test_diversity_only_swaps_in_linked_careers():
    d = dataset.load()
    for interests in (["computers"], ["helping people", "biology", "health"], ["engineering", "maths"]):
        top = engine.rank_careers(d, {**BASE, "interests": interests})
        for s in top:
            if s["diversity"]:
                assert s["fit"] != "none", (interests, s["career"]["name"])


def test_no_interests_keeps_old_behaviour_labels():
    d = dataset.load()
    top = engine.rank_careers(d, {**BASE, "interests": []})
    assert len(top) == 5 and all(s["why"].startswith(("Fits you", "A different option")) for s in top)


def test_plan_changes_are_reported():
    d = dataset.load()
    priya = next(s for s in d["students"] if s["name"] == "Priya")
    iti = next(p for p in d["plans"] if "iti_govt" in p["course_tags"])
    ch = engine.eligibility_changes(d, priya, iti)
    now = {e["id"]: e["status"] for e in engine.eligibility(d, priya)}
    after = {e["id"]: e["status"] for e in engine.eligibility(d, priya, iti)}
    assert ch["changed"] and {c["id"] for c in ch["changed"]} == {k for k in now if now[k] != after[k]}
    # the ITI stipend rule is about Govt ITI courses
    assert any(s["id"] in ch["for_this_course"] for s in d["scholarships"] if "ITI" in s["name"])


def test_short_course_has_no_course_scheme():
    d = dataset.load()
    short = next(p for p in d["plans"] if p["course_tags"] == ["skill_short"])
    for s in d["students"]:
        assert engine.eligibility_changes(d, s, short)["for_this_course"] == []


def test_hostel_choice_changes_result():
    d = dataset.load()
    priya = next(s for s in d["students"] if s["name"] == "Priya")
    bsc = next(p for p in d["plans"] if "ug" in p["course_tags"])
    yes = {e["id"]: e["status"] for e in engine.eligibility(d, priya, bsc, True)}
    no = {e["id"]: e["status"] for e in engine.eligibility(d, priya, bsc, False)}
    assert yes != no
