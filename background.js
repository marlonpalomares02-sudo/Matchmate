// MatchMate for Google Ads - Background Script (Service Worker)

// Track extension state
let extensionReady = false;

// Startup handler
chrome.runtime.onStartup.addListener(() => {
    console.log('MatchMate extension starting up');
    initializeExtension();
});

// Initialize extension state
async function initializeExtension() {
    try {
        // Verify storage access
        await chrome.storage.local.get(['matchmate_keywords']);
        extensionReady = true;
        console.log('MatchMate extension initialized successfully');
    } catch (error) {
        console.error('Failed to initialize extension:', error);
        extensionReady = false;
    }
}

// Extension installation and update handling
chrome.runtime.onInstalled.addListener((details) => {
    console.log('MatchMate extension installed/updated:', details.reason);
    
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
        }).then(() => {
            console.log('Default settings initialized');
            initializeExtension();
        }).catch(error => {
            console.error('Failed to set default settings:', error);
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
        initializeExtension();
    }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup, but we can add additional logic here if needed
    console.log('MatchMate icon clicked on tab:', tab.url);
});

// Message handling between popup and content scripts with improved error handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    // Validate request structure
    if (!request || !request.action) {
        console.error('Invalid message received:', request);
        sendResponse({ success: false, error: 'Invalid message format' });
        return false;
    }
    
    // Health check - respond immediately
    if (request.action === 'ping') {
        sendResponse({ success: true, ready: extensionReady });
        return false;
    }
    
    // Check if extension is ready before processing other requests
    if (!extensionReady) {
        console.warn('Extension not ready, initializing...');
        initializeExtension().then(() => {
            // Retry the original request
            handleMessage(request, sender, sendResponse);
        }).catch(error => {
            console.error('Failed to initialize extension:', error);
            sendResponse({ success: false, error: 'Extension initialization failed' });
        });
        return true; // Keep message channel open
    }
    
    return handleMessage(request, sender, sendResponse);
});

// Separate message handling function
function handleMessage(request, sender, sendResponse) {
    try {
        switch (request.action) {
            case 'detectKeywords':
                handleKeywordDetection(sender.tab?.id, sendResponse);
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
                handleAddKeyword(request.keyword, request.keywordData, request.isNegative, sendResponse);
                return true;

            case 'removeKeyword':
                handleRemoveKeyword(request.keyword, sendResponse);
                return true;

            case 'broadcastHighlight':
                handleBroadcastHighlight(request.keywords);
                sendResponse({ success: true });
                return false;
                
            default:
                console.log('Unknown action:', request.action);
                sendResponse({ success: false, error: 'Unknown action' });
                return false;
        }
    } catch (error) {
        console.error('Error processing message:', error);
        sendResponse({ success: false, error: error.message });
        return false;
    }
}

// Add keyword handler with enhanced data support
async function handleAddKeyword(keyword, keywordData = null, isNegative = false, sendResponse) {
    try {
        const result = await chrome.storage.local.get(['matchmate_keywords', 'matchmate_negative_keywords']);
        const existingKeywords = new Set(result.matchmate_keywords || []);
        const existingNegativeKeywords = new Set(result.matchmate_negative_keywords || []);
        
        // Determine if this should be a negative keyword
        const shouldBeNegative = isNegative || keyword.startsWith('-');
        const cleanKeyword = keyword.startsWith('-') ? keyword.substring(1) : keyword;
        
        if (shouldBeNegative) {
            // Handle negative keywords
            if (!existingNegativeKeywords.has(cleanKeyword)) {
                existingNegativeKeywords.add(cleanKeyword);
                await chrome.storage.local.set({ 
                    matchmate_negative_keywords: Array.from(existingNegativeKeywords)
                });
                
                // Store enhanced data if provided
                if (keywordData) {
                    await storeEnhancedKeywordData(cleanKeyword, keywordData, true);
                }
                
                // Notify all extension components to update
                try {
                    chrome.runtime.sendMessage({ action: 'keywordsUpdated' }).catch(() => {
                        // Popup might not be open, this is normal
                    });
                } catch (error) {
                    console.log('Could not notify popup:', error.message);
                }
                
                // Also notify content scripts on active tabs
                notifyContentScripts();
                
                showBadge('[-]', '#ff9800'); // Orange for negative
                sendResponse({ success: true, type: 'negative' });
            } else {
                sendResponse({ success: false, message: 'Negative keyword already exists' });
            }
        } else {
            // Handle regular keywords
            if (!existingKeywords.has(cleanKeyword)) {
                existingKeywords.add(cleanKeyword);
                await chrome.storage.local.set({ matchmate_keywords: Array.from(existingKeywords) });
                
                // Store enhanced data if provided
                if (keywordData) {
                    await storeEnhancedKeywordData(cleanKeyword, keywordData, false);
                }
                
                // Notify all extension components to update
                try {
                    chrome.runtime.sendMessage({ action: 'keywordsUpdated' }).catch(() => {
                        // Popup might not be open, this is normal
                    });
                } catch (error) {
                    console.log('Could not notify popup:', error.message);
                }
                
                // Also notify content scripts on active tabs with better error handling
                notifyContentScripts();
                
                showBadge('+', '#34a853'); // Green for add
                sendResponse({ success: true, type: 'positive' });
            } else {
                sendResponse({ success: false, message: 'Keyword already exists' });
            }
        }
    } catch (error) {
        console.error('Error adding keyword:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Improved content script notification with better error handling
async function notifyContentScripts() {
    try {
        const tabs = await chrome.tabs.query({ 
            url: ['https://ads.google.com/*', 'https://adwords.google.com/*']
        });
        
        const notifications = tabs.map(async (tab) => {
            try {
                // First ping to check if content script is ready
                await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
                // If ping succeeds, send the update
                await chrome.tabs.sendMessage(tab.id, { action: 'keywordsUpdated' });
                console.log(`Notified content script on tab ${tab.id}`);
            } catch (error) {
                console.log(`Could not notify tab ${tab.id}:`, error.message);
                // This is normal if content script is not loaded or tab is not on Google Ads
            }
        });
        
        await Promise.allSettled(notifications);
    } catch (error) {
        console.log('Error querying tabs:', error.message);
    }
}

// Store enhanced keyword data
async function storeEnhancedKeywordData(keyword, keywordData, isNegative) {
    try {
        const storageKey = `matchmate_enhanced_${isNegative ? 'negative_' : ''}${keyword}`;
        const enhancedData = {
            originalText: keywordData.originalText,
            detectedMatchType: keywordData.detectedMatchType,
            contextData: keywordData.contextData,
            source: keywordData.source,
            timestamp: keywordData.timestamp,
            isNegative: isNegative
        };
        
        await chrome.storage.local.set({ [storageKey]: enhancedData });
    } catch (error) {
        console.error('Error storing enhanced keyword data:', error);
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

// Keyword detection handler with improved error handling
async function handleKeywordDetection(tabId, sendResponse) {
    if (!tabId) {
        sendResponse({ 
            success: false, 
            error: 'No tab ID provided' 
        });
        return;
    }
    
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
            error: error.message || 'Unknown error during keyword detection'
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
    
    return Array.from(keywords).slice(0, 2000);
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

// Context Menu Setup with enhanced options
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

    // Add separator
    chrome.contextMenus.create({
        id: 'separator1',
        parentId: 'matchmate-parent',
        type: 'separator',
        contexts: ['selection']
    });

    // Add negative keyword options
    chrome.contextMenus.create({
        id: 'add-negative-broad',
        parentId: 'matchmate-parent',
        title: "Add as Negative Broad",
        contexts: ['selection']
    });

    chrome.contextMenus.create({
        id: 'add-negative-phrase',
        parentId: 'matchmate-parent',
        title: 'Add as Negative "Phrase"',
        contexts: ['selection']
    });

    chrome.contextMenus.create({
        id: 'add-negative-exact',
        parentId: 'matchmate-parent',
        title: 'Add as Negative [Exact]',
        contexts: ['selection']
    });

    // Add separator
    chrome.contextMenus.create({
        id: 'separator2',
        parentId: 'matchmate-parent',
        type: 'separator',
        contexts: ['selection']
    });

    // Add bulk actions
    chrome.contextMenus.create({
        id: 'add-with-related',
        parentId: 'matchmate-parent',
        title: "Add with Related Keywords",
        contexts: ['selection']
    });
});

// Context Menu Click Handler with enhanced functionality
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const selection = info.selectionText?.trim();
    if (!selection) return;

    let keyword = selection;
    let isNegative = false;
    let keywordData = {
        originalText: selection,
        source: 'context_menu',
        timestamp: Date.now(),
        contextData: {}
    };

    // Format keyword based on which menu item was clicked
    switch (info.menuItemId) {
        case 'add-phrase':
            keyword = `"${selection}"`;
            keywordData.detectedMatchType = 'phrase';
            break;
        case 'add-exact':
            keyword = `[${selection}]`;
            keywordData.detectedMatchType = 'exact';
            break;
        case 'add-negative-broad':
            keyword = selection;
            isNegative = true;
            keywordData.detectedMatchType = 'broad';
            break;
        case 'add-negative-phrase':
            keyword = `"${selection}"`;
            isNegative = true;
            keywordData.detectedMatchType = 'phrase';
            break;
        case 'add-negative-exact':
            keyword = `[${selection}]`;
            isNegative = true;
            keywordData.detectedMatchType = 'exact';
            break;
        case 'add-with-related':
            keyword = selection;
            keywordData.includeRelated = true;
            break;
        default: // 'add-broad'
            keyword = selection;
            keywordData.detectedMatchType = 'broad';
    }

    // Add the keyword using the enhanced handler
    handleAddKeyword(keyword, keywordData, isNegative, (response) => {
        if (response && response.success) {
            const type = response.type || 'positive';
            console.log(`Keyword "${keyword}" added as ${type} via context menu.`);
            
            // Highlight the keyword on the current page after adding
            chrome.tabs.sendMessage(tab.id, {
                action: 'highlightKeyword',
                keyword: selection, // Highlight the base keyword
                highlight: true
            }).catch(() => {
                // Content script might not be ready, ignore error
            });
            
            // Show appropriate badge
            const badgeText = isNegative ? '[-]' : '[+]';
            const badgeColor = isNegative ? '#ff9800' : '#34a853';
            showBadge(badgeText, badgeColor);
        } else {
            console.warn('Failed to add keyword via context menu:', response?.message || 'Unknown error');
        }
    });

    // Handle "add with related" functionality
    if (info.menuItemId === 'add-with-related') {
        // Request related keywords from content script
        chrome.tabs.sendMessage(tab.id, {
            action: 'getRelatedKeywords',
            keyword: selection
        }).then(response => {
            if (response && response.relatedKeywords) {
                response.relatedKeywords.slice(0, 3).forEach(relatedKeyword => {
                    const relatedData = {
                        originalText: relatedKeyword,
                        source: 'related_context_menu',
                        timestamp: Date.now(),
                        detectedMatchType: 'broad'
                    };
                    handleAddKeyword(relatedKeyword, relatedData, false, () => {});
                });
            }
        }).catch(() => {
            // Content script might not support this feature yet
        });
    }
});

// Broadcast a message to all Google Ads tabs with error handling
async function handleBroadcastHighlight(keywords) {
    if (!keywords || !Array.isArray(keywords)) {
        console.error('Invalid keywords for broadcast:', keywords);
        return;
    }
    
    try {
        const tabs = await chrome.tabs.query({
            url: [
                "https://ads.google.com/*",
                "https://adwords.google.com/*"
            ]
        });

        if (tabs.length === 0) {
            console.log('No Google Ads tabs found for broadcast');
            return;
        }

        // Send messages to all tabs with error handling for each
        const promises = tabs.map(async (tab) => {
            try {
                await chrome.tabs.sendMessage(tab.id, { 
                    action: 'highlightKeywords', 
                    keywords: keywords 
                });
            } catch (error) {
                console.warn(`Failed to send message to tab ${tab.id}:`, error.message);
            }
        });
        
        await Promise.allSettled(promises);
        console.log(`Broadcast highlight message sent to ${tabs.length} tabs`);
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

// Set up periodic cleanup (once a week) and initialize extension
chrome.runtime.onStartup.addListener(() => {
    console.log('MatchMate background script startup');
    initializeExtension();
    chrome.alarms.create('cleanup-storage', { 
        delayInMinutes: 1, 
        periodInMinutes: 7 * 24 * 60 // Weekly
    });
});

// Error handling and health check
chrome.runtime.onSuspend.addListener(() => {
    console.log('MatchMate background script suspending');
    extensionReady = false;
});

// Health check function
function isExtensionReady() {
    return extensionReady;
}

// Debug logging
if (chrome.runtime.getManifest().version.includes('dev')) {
    console.log('MatchMate background script loaded in development mode');
}

// Initialize on script load
initializeExtension();
