def get_or_create(key, cache={}):  # BUG: mutable default argument
    if key is 'default':  # BUG: 'is' for string comparison instead of '=='
        return None
    if key in cache:
        return cache[key]
    value = expensive_compute(key)
    cache[key] = value
    return value
