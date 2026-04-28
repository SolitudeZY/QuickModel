"""Palindrome utilities: detection, longest substring, and counting.

Provides three core palindrome functions with full type annotations,
Google-style docstrings, and embedded doctests.
"""

from __future__ import annotations

__all__ = ["is_palindrome", "longest_palindrome", "count_palindromes"]


def is_palindrome(s: str) -> bool:
    """Check whether a string is a palindrome, ignoring case, spaces, and punctuation.

    Args:
        s: The input string to check.

    Returns:
        True if *s* reads the same forward and backward after
        stripping non-alphanumeric characters and lowercasing; False otherwise.

    Examples:
        >>> is_palindrome("racecar")
        True
        >>> is_palindrome("A man, a plan, a canal: Panama")
        True
        >>> is_palindrome("hello")
        False
        >>> is_palindrome("")
        True
        >>> is_palindrome("No 'x' in Nixon")
        True
    """
    cleaned = "".join(c.lower() for c in s if c.isalnum())
    return cleaned == cleaned[::-1]


def longest_palindrome(s: str) -> str:
    """Return the longest palindromic substring using the center-expansion method.

    When multiple substrings share the same maximal length, the first one
    encountered (leftmost) is returned.

    Args:
        s: The input string (case-sensitive, spaces and punctuation are kept).

    Returns:
        The longest palindromic substring.  Returns an empty string if *s*
        is empty.

    Examples:
        >>> longest_palindrome("babad")
        'bab'
        >>> longest_palindrome("cbbd")
        'bb'
        >>> longest_palindrome("a")
        'a'
        >>> longest_palindrome("")
        ''
        >>> longest_palindrome("noon")
        'noon'
    """
    if not s:
        return ""

    start: int = 0
    max_len: int = 0
    n: int = len(s)

    for i in range(n):
        # --- odd-length palindromes (single-character center) ---
        max_possible_odd = 2 * min(i, n - 1 - i) + 1
        if max_possible_odd > max_len:
            l, r = i, i
            while l >= 0 and r < n and s[l] == s[r]:
                cur_len = r - l + 1
                if cur_len > max_len:
                    max_len = cur_len
                    start = l
                l -= 1
                r += 1

        # --- even-length palindromes (two-character center) ---
        max_possible_even = 2 * min(i, n - 2 - i) + 2
        if max_possible_even > max_len:
            l, r = i, i + 1
            while l >= 0 and r < n and s[l] == s[r]:
                cur_len = r - l + 1
                if cur_len > max_len:
                    max_len = cur_len
                    start = l
                l -= 1
                r += 1

    return s[start : start + max_len]


def count_palindromes(s: str) -> int:
    """Count every palindromic substring inside *s* (center-expansion).

    Single characters count as palindromes.  The comparison is
    case-sensitive and includes all characters.

    Args:
        s: The input string.

    Returns:
        The total number of distinct palindromic substrings (by position,
        not by content).

    Examples:
        >>> count_palindromes("abc")
        3
        >>> count_palindromes("aaa")
        6
        >>> count_palindromes("abba")
        6
        >>> count_palindromes("")
        0
    """
    if not s:
        return 0

    total: int = 0
    n: int = len(s)

    for i in range(n):
        # odd-length
        l, r = i, i
        while l >= 0 and r < n and s[l] == s[r]:
            total += 1
            l -= 1
            r += 1

        # even-length
        l, r = i, i + 1
        while l >= 0 and r < n and s[l] == s[r]:
            total += 1
            l -= 1
            r += 1

    return total


if __name__ == "__main__":
    import doctest

    # Run embedded doctests first
    print("Running doctests...")
    fail_count, test_count = doctest.testmod(verbose=False)
    print(f"Doctests: {test_count - fail_count}/{test_count} passed.\n")

    # ------------------------------------------------------------------
    # Additional manual tests (≥ 8 cases)
    # ------------------------------------------------------------------
    test_cases_is = [
        ("racecar", True),
        ("A man, a plan, a canal: Panama", True),
        ("hello", False),
        ("", True),
        ("No 'x' in Nixon", True),
        ("12321", True),
        ("123 321", True),
        ("abc123", False),
        ("Was it a car or a cat I saw?", True),
        ("Palindrome", False),
    ]

    test_cases_longest = [
        ("babad", "bab"),           # "bab" and "aba" both length 3; ours returns leftmost
        ("cbbd", "bb"),
        ("a", "a"),
        ("", ""),
        ("noon", "noon"),
        ("racecar", "racecar"),
        ("abcd", "a"),              # any single char
        ("abbacdef", "abba"),
        ("abcdefg", "a"),
        ("forgeeksskeegfor", "geeksskeeg"),
    ]

    test_cases_count = [
        ("abc", 3),
        ("aaa", 6),
        ("abba", 6),
        ("", 0),
        ("a", 1),
        ("aa", 3),
        ("aba", 4),
        ("abcd", 4),
        ("racecar", 10),            # 7 singles + cec + aceca + racecar = 10
        ("madam", 7),               # 5 singles + ada + madam = 7
    ]

    all_passed = True
    passed = failed = 0

    print("--- is_palindrome ---")
    for inp, expected in test_cases_is:
        result = is_palindrome(inp)
        status = "PASS" if result == expected else "FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
            all_passed = False
        print(f"  {status}: is_palindrome({inp!r}) = {result!r}  (expected {expected!r})")

    print("\n--- longest_palindrome ---")
    for inp, expected in test_cases_longest:
        result = longest_palindrome(inp)
        ok = result == expected or (inp == "babad" and result in ("bab", "aba"))
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
            all_passed = False
        print(f"  {status}: longest_palindrome({inp!r}) = {result!r}  (expected {expected!r})")

    print("\n--- count_palindromes ---")
    for inp, expected in test_cases_count:
        result = count_palindromes(inp)
        status = "PASS" if result == expected else "FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
            all_passed = False
        print(f"  {status}: count_palindromes({inp!r}) = {result!r}  (expected {expected!r})")

    print(f"\n{'=' * 50}")
    print(f"Results: {passed} passed, {failed} failed  ({passed + failed} total)")
    print("ALL TESTS PASSED!" if all_passed else "SOME TESTS FAILED!")
