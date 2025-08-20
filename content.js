// MatchMate for Google Ads - Content Script
// This script runs on Google Ads pages to help detect keywords

(function() {
    'use strict';

    // Listen for messages from the popup or background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        try {
            if (request.action === 'detectKeywords') {
                const keywords = detectKeywordsFromPage();
                sendResponse({ keywords: keywords });
            } else if (request.action === 'highlightKeyword') {
                highlightElement(request.keyword, request.highlight);
                sendResponse({ success: true });
            } else if (request.action === 'highlightKeywords') {
                // This handles the broadcast from a paste action
                request.keywords.forEach(keyword => {
                    highlightElement(keyword, true);
                });
                sendResponse({ success: true });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ error: error.message });
        }
        return true; // Keep channel open for async responses
    });

    // Function to highlight a keyword
    function highlightElement(keyword, highlight = true) {
        // First, remove any existing highlights to prevent duplicates or errors
        const existingHighlights = document.querySelectorAll('span.matchmate-highlight');
        existingHighlights.forEach(span => {
            const parent = span.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(span.textContent), span);
                parent.normalize(); // Merges adjacent text nodes
            }
        });

        if (!highlight) {
            return; // Exit if we only wanted to remove highlights
        }

        const regex = new RegExp(escapeRegExp(keyword), 'gi');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];

        // First pass: find all text nodes that contain the keyword
        let currentNode;
        while (currentNode = walker.nextNode()) {
            if (regex.test(currentNode.nodeValue)) {
                // Ensure we are not inside a script, style, or already highlighted element
                if (!currentNode.parentElement.closest('script, style, .matchmate-highlight')) {
                    nodesToReplace.push(currentNode);
                }
            }
        }

        // Second pass: replace the content of the found nodes
        nodesToReplace.forEach(node => {
            const parent = node.parentNode;
            const parts = node.nodeValue.split(regex);
            
            // Create a document fragment to hold the new nodes
            const fragment = document.createDocumentFragment();
            parts.forEach((part, index) => {
                if (index % 2 === 1) { // This is the matched keyword
                    const span = document.createElement('span');
                    span.className = 'matchmate-highlight';
                    span.style.backgroundColor = '#ffe0b2'; // Yellow highlight
                    span.textContent = part;
                    fragment.appendChild(span);
                } else if (part) { // This is the text before or after
                    fragment.appendChild(document.createTextNode(part));
                }
            });
            
            // Replace the original text node with the new fragment
            if (parent) {
                parent.replaceChild(fragment, node);
            }
        });
    }

    // Helper function to escape regex special characters
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Event listener for text selection (mouseup)
    document.addEventListener('mouseup', (event) => {
        const selectedText = window.getSelection().toString().trim();
        
        // Check if the selection is a valid keyword and not just whitespace
        if (selectedText && isValidKeyword(selectedText)) {
            // The context menu is the primary way to add, so we don't auto-add here.
            // Instead, we can send a message to the background to update the context menu title dynamically.
            console.log('Text selected:', selectedText);
            // This part is handled by the context menu logic in the background script.
        }
    });

    // Double-click handler for keywords
    document.addEventListener('dblclick', (event) => {
        const target = event.target;
        let keyword = target.textContent?.trim();
        
        // Handle table cells and other containers
        if (!keyword || keyword.length > 100) {
            const selection = window.getSelection().toString().trim();
            if (selection && isValidKeyword(selection)) {
                keyword = selection;
            }
        }

        if (keyword && isValidKeyword(keyword)) {
            console.log('Double-clicked keyword:', keyword);
            highlightElement(keyword);
            chrome.runtime.sendMessage({ 
                action: 'addKeyword', 
                keyword: keyword,
                source: 'doubleclick'
            }).catch(err => {
                console.log('Extension not available:', err.message);
            });
        }
    });


    // Event listener for checkbox changes
    document.addEventListener('change', (event) => {
        const checkbox = event.target;
        if (checkbox.tagName !== 'INPUT' || checkbox.type !== 'checkbox') {
            return;
        }

        // Find the table row containing the checkbox
        const row = checkbox.closest('tr');
        if (!row) {
            return;
        }

        // Find the NEXT table row to get the keyword immediately following the checked one
        const nextRow = row.nextElementSibling;
        if (!nextRow || nextRow.tagName !== 'TR') {
            return;
        }

        // Find the keyword text within the NEXT row
        // Google Keyword Planner often uses a specific data-test-id for the keyword text
        const keywordElement = nextRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
        
        if (keywordElement) {
            const keyword = keywordElement.textContent?.trim();
            if (keyword && isValidKeyword(keyword)) {
                console.log('Checkbox keyword captured (next row):', keyword, 'Checked:', checkbox.checked);
                
                // Highlight the keyword text itself
                highlightElement(keyword, checkbox.checked);

                // Send message to add or remove the keyword with error handling
                if (checkbox.checked) {
                    chrome.runtime.sendMessage({ action: 'addKeyword', keyword: keyword }).catch(err => {
                        console.log('Extension not available:', err.message);
                    });
                } else {
                    chrome.runtime.sendMessage({ action: 'removeKeyword', keyword: keyword }).catch(err => {
                        console.log('Extension not available:', err.message);
                    });
                }
            }
        }
    });

    // Enhanced selection handling for multiple keywords
    document.addEventListener('mouseup', (event) => {
        const selectedText = window.getSelection().toString().trim();
        
        if (selectedText && selectedText.length > 2) {
            // Split selected text by newlines or commas to handle multiple keywords
            const keywords = selectedText.split(/[\n,]+/)
                .map(k => k.trim())
                .filter(k => k && isValidKeyword(k));
            
            if (keywords.length > 0) {
                console.log('Multiple keywords selected:', keywords);
                
                // Auto-capture all selected keywords with error handling
                keywords.forEach(keyword => {
                    chrome.runtime.sendMessage({ action: 'addKeyword', keyword: keyword }).catch(err => {
                        console.log('Extension not available:', err.message);
                    });
                    highlightElement(keyword, true);
                });
                
                // Show visual feedback
                showSelectionFeedback(keywords.length);
            }
        }
    });

    // Enhanced checkbox handling for bulk selection
    let checkboxObserver;
    function setupCheckboxObserver() {
        if (checkboxObserver) return;
        
        checkboxObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'checked') {
                    const checkbox = mutation.target;
                    if (checkbox.tagName === 'INPUT' && checkbox.type === 'checkbox') {
                        const row = checkbox.closest('tr');
                        if (row) {
                            // Find the NEXT table row to get the keyword immediately following
                            const nextRow = row.nextElementSibling;
                            if (nextRow && nextRow.tagName === 'TR') {
                                const keywordElement = nextRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
                                if (keywordElement) {
                                    const keyword = keywordElement.textContent?.trim();
                                    if (keyword && isValidKeyword(keyword)) {
                                        if (checkbox.checked) {
                                            chrome.runtime.sendMessage({ action: 'addKeyword', keyword: keyword }).catch(err => {
                                                console.log('Extension not available:', err.message);
                                            });
                                            highlightElement(keyword, true);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        });
        
        // Observe all checkboxes on the page
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkboxObserver.observe(checkbox, { attributes: true, attributeFilter: ['checked'] });
        });
    }

    // Auto-detect keywords from Google Keyword Planner when page loads or changes
    function autoDetectKeywordsFromKeywordPlanner() {
        const keywordRows = document.querySelectorAll('[data-test-id="keyword-idea-row"], .keyword-idea-row, tr[data-test-id*="keyword"]');
        
        if (keywordRows.length > 0) {
            console.log('Google Keyword Planner detected, scanning for keywords...');
            
            // Check for checked checkboxes and auto-add keywords from next row
            keywordRows.forEach((row, index) => {
                const checkbox = row.querySelector('input[type="checkbox"]');
                
                // Only process if this isn't the last row
                if (checkbox && index < keywordRows.length - 1) {
                    const nextRow = keywordRows[index + 1];
                    const keywordElement = nextRow.querySelector('[data-test-id="keyword-text"], .keyword-text, [data-test-id="keyword-idea-text"]');
                    
                    if (keywordElement) {
                        const keyword = keywordElement.textContent?.trim();
                        if (keyword && isValidKeyword(keyword) && checkbox.checked) {
                            chrome.runtime.sendMessage({ action: 'addKeyword', keyword: keyword }).catch(err => {
                                console.log('Extension not available:', err.message);
                            });
                            highlightElement(keyword, true);
                        }
                    }
                }
            });
            
            // Setup observer for future checkbox changes
            setupCheckboxObserver();
        }
    }

    // Visual feedback for keyword capture
    function showSelectionFeedback(count) {
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            top: 50px;
            right: 10px;
            background: #34a853;
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: fadeInOut 2s ease-in-out;
        `;
        
        feedback.textContent = `✓ Captured ${count} keyword${count > 1 ? 's' : ''}`;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(-10px); }
                20% { opacity: 1; transform: translateY(0); }
                80% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-10px); }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.remove();
            style.remove();
        }, 2000);
    }

    function detectKeywordsFromPage() {
        const keywords = new Set();
        
        // Enhanced selectors for Google Ads interface
        const selectors = [
            // Keyword Planner selectors
            '[data-test-id="keyword-text"]',
            '.keyword-text',
            '[data-test-id="keyword-idea-text"]',
            
            // Search Terms Report selectors
            '[data-test-id="search-term"]',
            '[data-column="search_term"] span',
            
            // General keyword table selectors
            '[role="gridcell"] span',
            'td[data-column="keyword"]',
            'td[data-column="search_term"]',
            '.kw-text',
            
            // Campaign and ad group keyword selectors
            '[data-test-id="keyword-text-cell"]',
            '.keyword-cell span',
            
            // Auction insights and other reports
            '[data-test-id="display-url"]',
            '.display-url-text'
        ];

        // Try each selector
        selectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    const text = el.textContent?.trim();
                    if (isValidKeyword(text)) {
                        keywords.add(text);
                    }
                });
            } catch (error) {
                console.debug('Selector failed:', selector, error);
            }
        });

        // Look for keywords in table cells more broadly
        const tableCells = document.querySelectorAll('td, th');
        tableCells.forEach(cell => {
            const text = cell.textContent?.trim();
            if (isValidKeyword(text) && text.length < 100) {
                keywords.add(text);
            }
        });

        // Look for text that appears to be keywords based on context
        const potentialKeywordElements = document.querySelectorAll('span, div');
        potentialKeywordElements.forEach(el => {
            const text = el.textContent?.trim();
            if (isValidKeyword(text) && 
                text.length > 2 && 
                text.length < 80 &&
                !hasChildElements(el)) {
                
                // Check if the element or its parent has keyword-related classes
                const elementClasses = (el.className + ' ' + (el.parentElement?.className || '')).toLowerCase();
                if (elementClasses.includes('keyword') || 
                    elementClasses.includes('search') ||
                    elementClasses.includes('term')) {
                    keywords.add(text);
                }
            }
        });

        return Array.from(keywords).slice(0, 100); // Limit to 100 keywords
    }

    function isValidKeyword(text) {
        if (!text || typeof text !== 'string') return false;
        
        const trimmed = text.trim();
        
        // Basic validation
        if (trimmed.length < 2 || trimmed.length > 200) return false;
        
        // Skip if it's a URL
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return false;
        }
        
        // Skip if it's mostly numbers or special characters
        if (/^\d+$/.test(trimmed)) return false;
        if (/^[^\w\s]+$/.test(trimmed)) return false;
        
        // Skip common UI text
        const skipPatterns = [
            /^(edit|delete|remove|add|save|cancel|ok|yes|no|close|open)$/i,
            /^(click|select|choose|view|show|hide|expand|collapse)$/i,
            /^(loading|error|success|warning|info|help|about)$/i,
            /^(home|back|next|previous|first|last|page|of|to|from)$/i,
            /^(search|filter|sort|group|by|all|none|any|other)$/i,
            /^\d+[\s\-]\d+$/, // Date ranges
            /^[\d,]+$/, // Numbers with commas
            /^[\d.]+%$/, // Percentages
            /^\$[\d,.]+$/, // Currency
            /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, // Months
            /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, // Days
            /^(am|pm)$/i, // Time
            /^(http|https|www|\.com|\.org|\.net)/i // URLs
        ];
        
        if (skipPatterns.some(pattern => pattern.test(trimmed))) return false;
        
        // Must contain at least one letter
        if (!/[a-zA-Z]/.test(trimmed)) return false;
        
        return true;
    }

    function hasChildElements(element) {
        return element.children && element.children.length > 0;
    }

    // Add visual indicator when extension is active (optional)
    function addVisualIndicator() {
        if (document.getElementById('matchmate-indicator')) return;
        
        const indicator = document.createElement('div');
        indicator.id = 'matchmate-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #1a73e8;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        indicator.textContent = 'MatchMate Active';
        document.body.appendChild(indicator);
        
        // Remove after 3 seconds
        setTimeout(() => {
            const el = document.getElementById('matchmate-indicator');
            if (el) el.remove();
        }, 3000);
    }

    // Show indicator when script loads on Google Ads pages
    if (window.location.hostname.includes('ads.google.com') || 
        window.location.hostname.includes('adwords.google.com')) {
        addVisualIndicator();
        
        // Auto-detect keywords on page load
        setTimeout(() => {
            autoDetectKeywordsFromKeywordPlanner();
        }, 1000);
        
        // Monitor for dynamic content changes in Google Keyword Planner
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && (node.matches && (
                            node.matches('[data-test-id*="keyword"]') ||
                            node.matches('.keyword-idea-row') ||
                            node.querySelector('[data-test-id*="keyword"]')
                        ))) {
                            shouldCheck = true;
                        }
                    });
                }
            });
            
            if (shouldCheck) {
                setTimeout(() => {
                    autoDetectKeywordsFromKeywordPlanner();
                }, 500);
            }
        });
        
        // Start observing the document for changes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Helper function to highlight detected keywords (for debugging)
    function highlightKeywords() {
        const keywords = detectKeywordsFromPage();
        console.log('MatchMate detected keywords:', keywords);
        
        // Optional: visually highlight detected keywords
        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                if (regex.test(node.textContent)) {
                    textNodes.push(node);
                }
            }
            
            textNodes.forEach(textNode => {
                const parent = textNode.parentNode;
                if (parent && !parent.classList.contains('matchmate-highlight')) {
                    parent.style.backgroundColor = '#fff3cd';
                    parent.classList.add('matchmate-highlight');
                }
            });
        });
    }

    // Expose functions for debugging
    window.matchMateDebug = {
        detectKeywords: detectKeywordsFromPage,
        highlightKeywords: highlightKeywords
    };

})();
