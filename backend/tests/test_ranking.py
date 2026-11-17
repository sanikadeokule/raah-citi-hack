"""Top-5 career ranking: interest match comes first, and degree paths exist in the dataset."""
from raah import dataset, engine

D = dataset.load()
PROFILE = {"class": 10, "family_income_annual": 300000, "gender": "F"}
DEGREE_IDS = {"CAR47", "CAR48", "CAR49", "CAR50"}


def top(interests, n=5):
    return engine.rank_careers(D, {**PROFILE, "interests": interests}, n)


def test_dataset_has_sourced_degree_careers():
    by_id = {c["id"]: c for c in D["careers"]}
    for cid in DEGREE_IDS:
        c = by_id[cid]
        assert c["flags"]["degree"] and c["sources"] and c["tags"]
    assert "computers" in by_id["CAR47"]["tags"] and "computers" in by_id["CAR48"]["tags"]


def test_computers_interest_never_ranks_unrelated_careers_in_top5():
    ranked = top(["computers"])
    assert all(s["fit"] == "direct" for s in ranked)
    assert "Beautician / salon" not in [s["career"]["name"] for s in ranked]


def test_computers_interest_shows_a_degree_path():
    assert any(s["career"]["flags"]["degree"] for s in top(["computers"]))


def test_interest_match_beats_cheaper_or_closer_careers():
    # every direct match comes before any related / unrelated one, whatever the cost or demand
    ranked = top(["computers"], n=50)
    fits = [s["fit"] for s in ranked]
    assert fits == sorted(fits, key=lambda f: {"direct": 0, "related": 1, "none": 2}[f])


def test_commerce_interest_finds_bcom():
    assert "BCom" in " ".join(s["career"]["name"] for s in top(["business", "accounts"]))
