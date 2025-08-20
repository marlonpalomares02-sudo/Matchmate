// MatchMate for Google Ads - Background Script (Service Worker)

// Extension installation and update handling
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('MatchMate extension installed');
        
        // Set default settings
        chrome.storage.local.set({
            matchmate_settings: {
                fontFamily: 'Inter',
                fontSize: '14px',
                fontColor: '#333333',
                apiKey: ''
            },
            matchmate_keywords: []
        });
        
        // Open welcome page or show notification
        chrome.action.setBadgeText({ text: 'NEW' });
        chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
        
        // Clear badge after 24 hours
        setTimeout(() => {
            chrome.action.setBadgeText({ text: '' });
        }, 24 * 60 * 60 * 1000);
        
    } else if (details.reason === 'update') {
        console.log('MatchMate extension updated to version', chrome.runtime.getManifest().version);
    }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup, but we can add additional logic here if needed
    console.log('MatchMate icon clicked on tab:', tab.url);
});

// Message handling between popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    switch (request.action) {
        case 'detectKeywords':
            handleKeywordDetection(sender.tab.id, sendResponse);
            return true; // Keep message channel open for async response
            
        case 'saveKeywords':
            handleSaveKeywords(request.keywords, sendResponse);
            return true;
            
        case 'loadKeywords':
            handleLoadKeywords(sendResponse);
            return true;
            
        case 'exportKeywords':
            handleExportKeywords(request.keywords, request.format, sendResponse);
            return true;

        case 'addKeyword':
            handleAddKeyword(request.keyword, sendResponse);
            return true;

        case 'removeKeyword':
            handleRemoveKeyword(request.keyword, sendResponse);
            return true;

        case 'broadcastHighlight':
            handleBroadcastHighlight(request.keywords);
            return false; // No response needed
            
        default:
            console.log('Unknown action:', request.action);
            sendResponse({ error: 'Unknown action' });
    }
});

// Add keyword handler
async function handleAddKeyword(keyword, sendResponse) {
    try {
        const result = await chrome.storage.local.get(['matchmate_keywords']);
        const existingKeywords = new Set(result.matchmate_keywords || []);
        if (!existingKeywords.has(keyword)) {
            existingKeywords.add(keyword);
            await chrome.storage.local.set({ matchmate_keywords: Array.from(existingKeywords) });
            
            // Notify all extension components to update
            chrome.runtime.sendMessage({ action: 'keywordsUpdated' });
            
            // Also notify content scripts on active tabs
            const tabs = await chrome.tabs.query({ url: ['https://ads.google.com/*', 'https://adwords.google.com/*'] });
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'keywordsUpdated' }).catch(() => {});
            });
            
            showBadge('+', '#34a853'); // Green for add
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, message: 'Keyword already exists' });
        }
    } catch (error) {
        console.error('Error adding keyword:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Remove keyword handler
async function handleRemoveKeyword(keyword, sendResponse) {
    try {
        const result = await chrome.storage.local.get(['matchmate_keywords']);
        let existingKeywords = result.matchmate_keywords || [];
        const initialLength = existingKeywords.length;
        existingKeywords = existingKeywords.filter(k => k !== keyword);
        
        if (existingKeywords.length < initialLength) {
            await chrome.storage.local.set({ matchmate_keywords: existingKeywords });
            
            // Notify popup to update and show badge
            chrome.runtime.sendMessage({ action: 'keywordsUpdated' });
            showBadge('-', '#ea4335'); // Red for remove
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, message: 'Keyword not found' });
        }
    } catch (error) {
        console.error('Error removing keyword:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Keyword detection handler
async function handleKeywordDetection(tabId, sendResponse) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: extractKeywordsFromPage
        });
        
        if (results && results[0] && results[0].result) {
            sendResponse({ 
                success: true, 
                keywords: results[0].result 
            });
        } else {
            sendResponse({ 
                success: false, 
                error: 'No keywords found' 
            });
        }
    } catch (error) {
        console.error('Error detecting keywords:', error);
        sendResponse({ 
            success: false, 
            error: error.message 
        });
    }
}

// This function will be injected into the page
function extractKeywordsFromPage() {
    const keywords = new Set();
    
    // Enhanced selectors for Google Ads
    const selectors = [
        '[data-test-id="keyword-text"]',
        '.keyword-text',
        '[data-test-id="keyword-idea-text"]',
        '[data-test-id="search-term"]',
        '[data-column="search_term"] span',
        '[role="gridcell"] span',
        'td[data-column="keyword"]',
        'td[data-column="search_term"]',
        '.kw-text'
    ];
    
    selectors.forEach(selector => {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                const text = el.textContent?.trim();
                if (text && text.length > 1 && text.length < 200) {
                    keywords.add(text);
                }
            });
        } catch (error) {
            console.debug('Selector failed:', selector);
        }
    });
    
    return Array.from(keywords).slice(0, 50);
}

// Save keywords handler
async function handleSaveKeywords(keywords, sendResponse) {
    try {
        await chrome.storage.local.set({ matchmate_keywords: keywords });
        sendResponse({ success: true });
    } catch (error) {
        console.error('Error saving keywords:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Load keywords handler
async function handleLoadKeywords(sendResponse) {
    try {
        const result = await chrome.storage.local.get(['matchmate_keywords']);
        sendResponse({ 
            success: true, 
            keywords: result.matchmate_keywords || [] 
        });
    } catch (error) {
        console.error('Error loading keywords:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Export keywords handler
async function handleExportKeywords(keywords, format, sendResponse) {
    try {
        let content;
        let filename;
        let mimeType;
        
        const timestamp = new Date().toISOString().split('T')[0];
        
        switch (format) {
            case 'csv':
                content = 'Keyword\n' + keywords.map(k => `"${k}"`).join('\n');
                filename = `matchmate-keywords-${timestamp}.csv`;
                mimeType = 'text/csv';
                break;
                
            case 'txt':
                content = keywords.join('\n');
                filename = `matchmate-keywords-${timestamp}.txt`;
                mimeType = 'text/plain';
                break;
                
            case 'json':
                content = JSON.stringify({
                    exported_at: new Date().toISOString(),
                    keyword_count: keywords.length,
                    keywords: keywords
                }, null, 2);
                filename = `matchmate-keywords-${timestamp}.json`;
                mimeType = 'application/json';
                break;
                
            default:
                throw new Error('Unsupported export format');
        }
        
        // Create download
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        });
        
        sendResponse({ success: true, filename: filename });
        
    } catch (error) {
        console.error('Error exporting keywords:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Context Menu Setup
chrome.runtime.onInstalled.addListener(() => {
    // Create a parent menu item
    chrome.contextMenus.create({
        id: 'matchmate-parent',
        title: 'MatchMate Actions',
        contexts: ['selection'],
        documentUrlPatterns: ["https://ads.google.com/*", "https://adwords.google.com/*"]
    });

    // Create child menu items for different match types
    chrome.contextMenus.create({
        id: 'add-broad',
        parentId: 'matchmate-parent',
        title: "Add as Broad Match",
        contexts: ['selection']
    });

    chrome.contextMenus.create({
        id: 'add-phrase',
        parentId: 'matchmate-parent',
        title: 'Add as "Phrase Match"',
        contexts: ['selection']
    });

    chrome.contextMenus.create({
        id: 'add-exact',
        parentId: 'matchmate-parent',
        title: 'Add as [Exact Match]',
        contexts: ['selection']
    });
});

// Context Menu Click Handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const selection = info.selectionText?.trim();
    if (!selection) return;

    let keyword = selection;

    // Format keyword based on which menu item was clicked
    switch (info.menuItemId) {
        case 'add-phrase':
            keyword = `"${selection}"`;
            break;
        case 'add-exact':
            keyword = `[${selection}]`;
            break;
        // 'add-broad' is the default
    }

    // Add the keyword using the existing handler
    handleAddKeyword(keyword, (response) => {
        if (response && response.success) {
            console.log(`Keyword "${keyword}" added via context menu.`);
            // Highlight the keyword on the current page after adding
            chrome.tabs.sendMessage(tab.id, {
                action: 'highlightKeyword',
                keyword: selection, // Highlight the base keyword
                highlight: true
            });
        }
    });
});

// Broadcast a message to all Google Ads tabs
async function handleBroadcastHighlight(keywords) {
    try {
        const tabs = await chrome.tabs.query({
            url: [
                "https://ads.google.com/*",
                "https://adwords.google.com/*"
            ]
        });

        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { 
                action: 'highlightKeywords', 
                keywords: keywords 
            });
        });
    } catch (error) {
        console.error('Error broadcasting highlight message:', error);
    }
}

// Helper function to show a temporary badge on the icon
function showBadge(text, color) {
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: color });
    setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
    }, 2000); // Badge disappears after 2 seconds
}

// Alarm handling for periodic tasks (if needed)
chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('Alarm triggered:', alarm.name);
    
    switch (alarm.name) {
        case 'cleanup-storage':
            cleanupOldData();
            break;
    }
});

// Cleanup old data periodically
async function cleanupOldData() {
    try {
        const result = await chrome.storage.local.get(null);
        const keys = Object.keys(result);
        
        // Remove old session data (older than 30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        keys.forEach(key => {
            if (key.startsWith('matchmate_session_')) {
                const timestamp = parseInt(key.split('_')[2]);
                if (timestamp < thirtyDaysAgo) {
                    chrome.storage.local.remove(key);
                }
            }
        });
        
        console.log('Storage cleanup completed');
    } catch (error) {
        console.error('Error during storage cleanup:', error);
    }
}

// Set up periodic cleanup (once a week)
chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('cleanup-storage', { 
        delayInMinutes: 1, 
        periodInMinutes: 7 * 24 * 60 // Weekly
    });
});

// Error handling
chrome.runtime.onSuspend.addListener(() => {
    console.log('MatchMate background script suspending');
});

// Debug logging
if (chrome.runtime.getManifest().version.includes('dev')) {
    console.log('MatchMate background script loaded in development mode');
}
