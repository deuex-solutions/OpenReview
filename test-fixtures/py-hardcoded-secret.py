import requests

API_KEY = 'sk-prod-a8f3b2c1d4e5f6789012345678901234'  # BUG: hardcoded secret

def fetch_data(endpoint):
    url = 'https://api.example.com/' + endpoint  # BUG: no input validation
    response = requests.get(url, headers={'Authorization': API_KEY})
    return response.json()
