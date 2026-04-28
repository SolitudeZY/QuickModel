"""Anagram utilities — detection, grouping, and dictionary counting.

Provides efficient functions for identifying and grouping anagrams,
using a character-sorted signature approach with O(n * k * log k)
complexity for grouping.

All functions apply Unicode NFC normalization to their string
arguments before computing signatures, so that visually identical
text composed of different code-point sequences (e.g., composed vs.
decomposed forms) is treated consistently.
"""

from __future__ import annotations

import unicodedata
from collections import defaultdict

__all__ = ["are_anagrams", "group_anagrams", "anagram_count"]


def are_anagrams(s1: str, s2: str) -> bool:
    """Return True if *s1* and *s2* are anagrams of each other.

    Two strings are anagrams when they contain exactly the same
    characters with the same frequencies. Both case and whitespace
    are significant — neither is ignored.

    Args:
        s1: First string to compare.
        s2: Second string to compare.

    Returns:
        ``True`` when the sorted characters of *s1* and *s2* match.

    Raises:
        TypeError: If either argument is not a string.

    Examples:
        >>> are_anagrams("listen", "silent")
        True
        >>> are_anagrams("hello", "world")
        False
        >>> are_anagrams("", "")
        True
        >>> are_anagrams("a", "aa")
        False
        >>> are_anagrams("Tom Marvolo Riddle", "I am Lord Voldemort")
        False
    """
    if not isinstance(s1, str) or not isinstance(s2, str):
        raise TypeError("Both arguments must be strings.")
    s1 = unicodedata.normalize("NFC", s1)
    s2 = unicodedata.normalize("NFC", s2)
    return sorted(s1) == sorted(s2)


def group_anagrams(words: list[str]) -> list[list[str]]:
    """Group *words* into sublists of mutual anagrams.

    Each sublist contains strings that are anagrams of one another.
    The relative order within a group follows the original appearance
    order in *words*; groups themselves are ordered by the earliest
    member.

    Complexity: O(n * k * log k) where *n* is the number of words and
    *k* the maximum word length (driven by sorting each word).

    Args:
        words: A list of strings to partition.

    Returns:
        A list of anagram groups (each group is ``list[str]``).

    Raises:
        TypeError: If *words* is not a list, or any element is not a str.

    Examples:
        >>> group_anagrams(["eat", "tea", "tan", "ate", "nat", "bat"])
        [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']]
        >>> group_anagrams([""])
        [['']]
        >>> group_anagrams(["a", "b", "a"])
        [['a', 'a'], ['b']]
        >>> group_anagrams([])
        []
    """
    if not isinstance(words, list):
        raise TypeError("words must be a list.")

    groups: dict[str, list[str]] = defaultdict(list)
    for w in words:
        if not isinstance(w, str):
            raise TypeError(f"Every element must be str, got {type(w).__name__}.")
        key = "".join(sorted(unicodedata.normalize("NFC", w)))
        groups[key].append(w)

    return list(groups.values())


def anagram_count(word: str, dictionary: list[str]) -> int:
    """Count entries in *dictionary* that are anagrams of *word*.

    The function does **not** count *word* itself unless it appears
    in *dictionary*.  Comparison is case-sensitive and whitespace-
    sensitive (same contract as :func:`are_anagrams`).

    Args:
        word: The reference word.
        dictionary: A list of candidate strings.

    Returns:
        How many items in *dictionary* are anagrams of *word*.

    Raises:
        TypeError: If *word* is not a string or *dictionary* is not a
            list of strings.

    Examples:
        >>> anagram_count("listen", ["enlist", "silent", "tinsel", "hello"])
        3
        >>> anagram_count("a", ["a", "b", "aa"])
        1
        >>> anagram_count("", ["", "a"])
        1
        >>> anagram_count("rat", ["tar", "art", "rat", "car"])
        3
    """
    if not isinstance(word, str):
        raise TypeError("word must be a string.")
    if not isinstance(dictionary, list):
        raise TypeError("dictionary must be a list.")

    signature = sorted(unicodedata.normalize("NFC", word))
    count = 0
    for entry in dictionary:
        if not isinstance(entry, str):
            raise TypeError(
                f"Every dictionary entry must be str, got {type(entry).__name__}."
            )
        if sorted(unicodedata.normalize("NFC", entry)) == signature:
            count += 1
    return count


if __name__ == "__main__":
    import doctest

    # ------------------------------------------------------------------
    # Run doctests embedded in the three public functions above.
    # ------------------------------------------------------------------
    print("Running doctests …")
    failures, tests = doctest.testmod(verbose=False)
    print(f"Doctests: {tests} run, {failures} failed.\n")

    # ------------------------------------------------------------------
    # Additional manual smoke-tests (10 cases).
    # ------------------------------------------------------------------
    test_count = 0

    # --- are_anagrams ---
    assert are_anagrams("binary", "brainy") is True, "TC1"
    test_count += 1

    assert are_anagrams("Python", "Typhon") is False, "TC2"
    test_count += 1

    assert are_anagrams("a😊b", "b😊a") is True, "TC3 – unicode"
    test_count += 1

    # --- group_anagrams ---
    result = group_anagrams(["cat", "dog", "tac", "god", "act"])
    expected = [["cat", "tac", "act"], ["dog", "god"]]
    assert result == expected, f"TC4: {result}"
    test_count += 1

    assert group_anagrams([]) == [], "TC5 – empty"
    test_count += 1

    result2 = group_anagrams(["abc", "def", "ghi"])
    assert all(len(g) == 1 for g in result2), "TC6 – no anagrams"
    test_count += 1

    # --- anagram_count ---
    assert anagram_count("stressed", ["desserts", "deserts", "stressed"]) == 2, "TC7"
    test_count += 1

    assert anagram_count("xyz", ["abc", "def"]) == 0, "TC8 – none"
    test_count += 1

    assert (
        anagram_count("tea", ["ate", "eat", "eta", "coffee", "tea"]) == 4
    ), "TC9"
    test_count += 1

    assert (
        anagram_count("Tea", ["tae", "eat", "ate"]) == 0
    ), "TC10 – case sensitivity"
    test_count += 1

    print(f"All {test_count} smoke-tests passed.")
