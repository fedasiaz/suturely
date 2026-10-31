// finder.js

async function findIssues() {
  console.log('Searching GitHub for fresh ERR_REQUIRE_ESM issues...');
  
  // Мы используем публичный API GitHub без токена
  const query = encodeURIComponent('is:issue is:open "ERR_REQUIRE_ESM" no:assignee');
  const url = `https://api.github.com/search/issues?q=${query}&sort=created&order=desc&per_page=5`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'suturely-finder',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      console.log('No issues found right now. Try again later.');
      return;
    }

    console.log('\nFound these fresh issues:\n');
    data.items.forEach((issue, i) => {
      console.log(`[${i + 1}] ${issue.title}`);
      console.log(`    Repo: ${issue.repository_url.split('/repos/')[1]}`);
      console.log(`    URL:  ${issue.html_url}\n`);
    });

  } catch (error) {
    console.error('Error fetching from GitHub:', error.message);
  }
}

findIssues();