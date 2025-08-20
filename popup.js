// MatchMate for Google Ads - Popup Script
class MatchMate {
    constructor() {
        this.keywords = [];
        this.settings = {
            fontFamily: 'Inter',
            fontSize: '14px',
            fontColor: '#333333',
            apiKey: ''
        };
        this.init(); 
    }

    async init() {
        await this.loadSettings();
        this.applySettings();
        this.bindEvents();
        this.loadKeywords();
    }

    // Settings Management
    async loadSettings() {
        try {
            const result = await chrome.storage.local.get(['matchmate_settings']);
            if (result.matchmate_settings) {
                this.settings = { ...this.settings, ...result.matchmate_settings };
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.local.set({ matchmate_settings: this.settings });
            this.applySettings();
            this.showNotification('Settings saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Error saving settings', 'error');
        }
    }

    applySettings() {
        document.body.style.fontFamily = this.settings.fontFamily;
        document.body.style.fontSize = this.settings.fontSize;
        document.body.style.color = this.settings.fontColor;
        
        // Update settings form
        document.getElementById('fontFamily').value = this.settings.fontFamily;
        document.getElementById('fontSize').value = this.settings.fontSize;
        document.getElementById('fontColor').value = this.settings.fontColor;
        document.getElementById('apiKey').value = this.settings.apiKey;
    }

    // Event Binding
    bindEvents() {
        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => this.toggleSettings());
        document.getElementById('closeSettingsBtn').addEventListener('click', () => this.toggleSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettingsFromForm());
        
        // Listen for keyword updates from background script
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'keywordsUpdated') {
                this.loadKeywords(); // Refresh keywords from storage
            }
        });

        // Import
        document.getElementById('pasteBtn').addEventListener('click', () => this.pasteFromClipboard());
        document.getElementById('detectBtn').addEventListener('click', () => this.detectFromPage());
        document.getElementById('keywordInput').addEventListener('input', (e) => this.handleKeywordInput(e));

        // Match Types
        document.getElementById('broadBtn').addEventListener('click', () => this.convertMatchType('broad'));
        document.getElementById('phraseBtn').addEventListener('click', () => this.convertMatchType('phrase'));
        document.getElementById('exactBtn').addEventListener('click', () => this.convertMatchType('exact'));

        // Filters
        document.getElementById('removeJunkBtn').addEventListener('click', () => this.removeJunkKeywords());
        document.getElementById('removeDuplicatesBtn').addEventListener('click', () => this.removeDuplicates());
        document.getElementById('capitalizeBtn').addEventListener('click', () => this.capitalizeKeywords());
        document.getElementById('customFilter').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.applyCustomFilter();
        });

        // AI
        document.getElementById('getSuggestionsBtn').addEventListener('click', () => this.getAISuggestions());
        document.getElementById('expandAdGroupBtn').addEventListener('click', () => this.expandAdGroup());

        // AI Rewriting
        document.getElementById('painPointBtn').addEventListener('click', () => this.rewriteKeywords('pain_points'));
        document.getElementById('cleverBtn').addEventListener('click', () => this.rewriteKeywords('clever'));
        document.getElementById('benefitBtn').addEventListener('click', () => this.rewriteKeywords('beneficial'));
        document.getElementById('funnyBtn').addEventListener('click', () => this.rewriteKeywords('funny'));

        // Modal
        document.getElementById('closeModalBtn').addEventListener('click', () => this.closeAIModal());
        document.getElementById('addSelectedBtn').addEventListener('click', () => this.addSelectedKeywords());
        document.getElementById('cancelModalBtn').addEventListener('click', () => this.closeAIModal());


        // Export
        document.getElementById('copyToClipboardBtn').addEventListener('click', () => this.copyToClipboard());
        document.getElementById('downloadCsvBtn').addEventListener('click', () => this.downloadCSV());

        // Clear All
        document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAllKeywords());
    }

    // Keyword Management
    async loadKeywords() {
        try {
            const result = await chrome.storage.local.get(['matchmate_keywords']);
            if (result.matchmate_keywords) {
                this.keywords = result.matchmate_keywords;
                this.updateKeywordDisplay();
            }
        } catch (error) {
            console.error('Error loading keywords:', error);
        }
    }

    async saveKeywords() {
        try {
            await chrome.runtime.sendMessage({ action: 'saveKeywords', keywords: this.keywords });
        } catch (error) {
            if (error.message.includes('Receiving end does not exist')) {
                console.warn('Connection to background script failed. It might be inactive.');
                this.showNotification('Could not connect to the background script. Please try again.', 'error');
            } else {
                console.error('Error saving keywords:', error);
            }
        }
    }

    handleKeywordInput(event) {
        const text = event.target.value;
        if (text.trim()) {
            this.importKeywords(text);
            event.target.value = ''; // Clear input after adding
        }
    }

    importKeywords(text) {
        const lines = text.split('\n').filter(line => line.trim());
        const newKeywords = lines.map(line => line.trim()).filter(keyword => keyword);
        
        // Add new keywords, avoiding duplicates
        newKeywords.forEach(keyword => {
            if (!this.keywords.includes(keyword)) {
                this.keywords.push(keyword);
            }
        });
        
        this.updateKeywordDisplay();
        this.saveKeywords();
    }

    addKeyword(keyword) {
        if (!this.keywords.includes(keyword)) {
            this.keywords.push(keyword);
            this.updateKeywordDisplay();
            this.saveKeywords();
            this.showNotification(`Added "${keyword}"`, 'success');
        }
    }

    removeKeyword(index) {
        const keywordToRemove = this.keywords[index];
        this.keywords.splice(index, 1);
        this.updateKeywordDisplay();
        this.saveKeywords();
        this.showNotification(`Removed "${keywordToRemove}"`, 'info');
    }

    clearAllKeywords() {
        if (this.keywords.length === 0) {
            this.showNotification('Keyword list is already empty.', 'info');
            return;
        }
        
        const keywordCount = this.keywords.length;
        this.keywords = [];
        this.updateKeywordDisplay();
        this.saveKeywords();
        this.showNotification(`Cleared ${keywordCount} keywords.`, 'success');
    }

    updateKeywordDisplay() {
        const container = document.getElementById('keywordsList');
        const countElement = document.getElementById('keywordCount');
        
        countElement.textContent = this.keywords.length;
        
        if (this.keywords.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No keywords yet. Import some keywords to get started!</p></div>';
            return;
        }

        container.innerHTML = ''; // Clear existing content
        this.keywords.forEach((keyword, index) => {
            const item = document.createElement('div');
            item.className = 'keyword-item';
            
            const text = document.createElement('span');
            text.className = 'keyword-text';
            text.textContent = keyword;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'keyword-remove';
            removeBtn.innerHTML = '✕';
            removeBtn.addEventListener('click', () => this.removeKeyword(index));
            
            item.appendChild(text);
            item.appendChild(removeBtn);
            container.appendChild(item);
        });
    }

    // Import Functions
    async pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) {
                const keywords = text.split('\n').map(k => k.trim()).filter(Boolean);
                
                // Add to the popup UI
                this.importKeywords(text);
                this.showNotification(`${keywords.length} keywords pasted from clipboard!`, 'success');

                // Broadcast to all Google Ads tabs to highlight these keywords
                try {
                    chrome.runtime.sendMessage({ 
                        action: 'broadcastHighlight', 
                        keywords: keywords 
                    });
                } catch (error) {
                    if (error.message.includes('Receiving end does not exist')) {
                        console.warn('Connection to background script failed for broadcast.');
                    } else {
                        console.error('Error broadcasting keywords:', error);
                    }
                }

            } else {
                this.showNotification('Clipboard is empty', 'warning');
            }
        } catch (error) {
            console.error('Error reading clipboard:', error);
            this.showNotification('Error reading clipboard. Please paste manually.', 'error');
        }
    }

    async detectFromPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('ads.google.com') && !tab.url.includes('adwords.google.com')) {
                this.showNotification('Please navigate to Google Ads first', 'warning');
                return;
            }

            // Send message to background script to detect keywords
            let response;
            try {
                response = await chrome.runtime.sendMessage({ action: 'detectKeywords' });
            } catch (error) {
                if (error.message.includes('Receiving end does not exist')) {
                    this.showNotification('Could not connect to the background script. Please try again.', 'error');
                    return;
                }
                throw error; // Re-throw other errors
            }

            if (response && response.success && response.keywords && response.keywords.length > 0) {
                const detectedKeywords = response.keywords.join('\n');
                document.getElementById('keywordInput').value = detectedKeywords;
                this.importKeywords(detectedKeywords);
                this.showNotification(`Detected ${response.keywords.length} keywords from page!`, 'success');
            } else {
                this.showNotification('No keywords detected on this page', 'warning');
            }
        } catch (error) {
            console.error('Error detecting keywords:', error);
            this.showNotification('Error detecting keywords from page', 'error');
        }
    }

    // Match Type Conversion
    convertMatchType(type) {
        if (this.keywords.length === 0) {
            this.showNotification('No keywords to convert', 'warning');
            return;
        }

        this.keywords = this.keywords.map(keyword => {
            // Remove existing match type symbols
            let cleanKeyword = keyword.replace(/^[\[\"]|[\]\"]$/g, '');
            
            switch (type) {
                case 'broad':
                    return cleanKeyword;
                case 'phrase':
                    return `"${cleanKeyword}"`;
                case 'exact':
                    return `[${cleanKeyword}]`;
                default:
                    return cleanKeyword;
            }
        });

        this.updateKeywordDisplay();
        this.saveKeywords();
        this.showNotification(`Converted to ${type} match type!`, 'success');
    }

    // Filtering Functions
    capitalizeKeywords() {
        if (this.keywords.length === 0) {
            this.showNotification('No keywords to capitalize', 'warning');
            return;
        }

        this.keywords = this.keywords.map(keyword => {
            // Capitalize the first letter of each word.
            return keyword.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
        });

        this.updateKeywordDisplay();
        this.saveKeywords();
        this.showNotification('Keywords capitalized!', 'success');
    }

    removeJunkKeywords() {
        const junkPatterns = [
            /^\d+$/, // Only numbers
            /^.{1,2}$/, // Too short (1-2 characters)
            /^.{100,}$/, // Too long (100+ characters)
            /[^\w\s\-]/g, // Special characters except hyphens
            /\b(test|example|sample|demo)\b/i, // Common junk words
            /^(a|an|the|and|or|but|in|on|at|to|for|of|with|by)$/i // Stop words
        ];

        const originalCount = this.keywords.length;
        this.keywords = this.keywords.filter(keyword => {
            const cleanKeyword = keyword.replace(/^[\[\"]|[\]\"]$/g, '');
            return !junkPatterns.some(pattern => pattern.test(cleanKeyword));
        });

        const removedCount = originalCount - this.keywords.length;
        this.updateKeywordDisplay();
        this.saveKeywords();
        this.showNotification(`Removed ${removedCount} junk keywords!`, 'success');
    }

    removeDuplicates() {
        const originalCount = this.keywords.length;
        this.keywords = [...new Set(this.keywords)];
        const removedCount = originalCount - this.keywords.length;
        
        this.updateKeywordDisplay();
        this.saveKeywords();
        this.showNotification(`Removed ${removedCount} duplicate keywords!`, 'success');
    }

    applyCustomFilter() {
        const filterInput = document.getElementById('customFilter');
        const pattern = filterInput.value.trim();
        
        if (!pattern) {
            this.showNotification('Please enter a filter pattern', 'warning');
            return;
        }

        try {
            const regex = new RegExp(pattern, 'i');
            const originalCount = this.keywords.length;
            this.keywords = this.keywords.filter(keyword => !regex.test(keyword));
            const removedCount = originalCount - this.keywords.length;
            
            this.updateKeywordDisplay();
            this.saveKeywords();
            this.showNotification(`Removed ${removedCount} keywords matching pattern!`, 'success');
            filterInput.value = '';
        } catch (error) {
            this.showNotification('Invalid regex pattern', 'error');
        }
    }

    // AI Functions
    async rewriteKeywords(tone) {
        if (!this.settings.apiKey) {
            this.showNotification('Please set your DeepSeek API key in settings', 'warning');
            return;
        }

        if (this.keywords.length === 0) {
            this.showNotification('Add some keywords first to rewrite', 'warning');
            return;
        }

        const button = event.target;
        this.setButtonLoading(button, true, 'Rewriting...');

        const tonePrompts = {
            pain_points: `Rewrite the following keywords to focus on customer pain points. Turn them into questions or phrases that a user would search for when they have a problem.`,
            clever: `Rewrite the following keywords to be more clever and catchy. Use wordplay, metaphors, or unexpected angles.`,
            beneficial: `Rewrite the following keywords to highlight the key benefits for the customer. Focus on the value and outcomes.`,
            funny: `Rewrite the following keywords with a humorous or funny twist. Make them memorable and shareable.`
        };

        const prompt = `${tonePrompts[tone]} Base keywords: ${this.keywords.join(', ')}. Return only the rewritten keywords, one per line.`;

        try {
            const rewrittenKeywords = await this.callDeepSeekAPI(prompt);

            if (rewrittenKeywords) {
                const newKeywords = rewrittenKeywords.split('\n')
                    .map(k => k.trim())
                    .filter(k => k);
                this.showAIModal(`Rewritten Keywords (${tone.replace('_', ' ')})`, newKeywords);
            }
        } catch (error) {
            console.error(`Error rewriting keywords with ${tone} tone:`, error);
            this.showNotification('Error rewriting keywords', 'error');
        } finally {
            this.setButtonLoading(button, false);
        }
    }

    async getAISuggestions() {
        if (!this.settings.apiKey) {
            this.showNotification('Please set your DeepSeek API key in settings', 'warning');
            return;
        }

        if (this.keywords.length === 0) {
            this.showNotification('Add some keywords first to get suggestions', 'warning');
            return;
        }

        const button = event.target;
        this.setButtonLoading(button, true, 'Generating...');

        try {
            const suggestions = await this.callDeepSeekAPI(
                `Generate 10 highly relevant, high-intent keyword suggestions for the following Google Ads keywords: ${this.keywords.slice(0, 5).join(', ')}. Focus on commercial and transactional keywords. Avoid broad or informational queries. Return only the keywords, one per line.`
            );

            if (suggestions) {
                const newKeywords = suggestions.split('\n')
                    .map(k => k.trim())
                    .filter(k => k && !this.keywords.includes(k));
                
                this.showAIModal('AI Suggestions', newKeywords);
            }
        } catch (error) {
            console.error('Error getting AI suggestions:', error);
            this.showNotification('Error getting AI suggestions', 'error');
        } finally {
            this.setButtonLoading(button, false);
        }
    }

    async expandAdGroup() {
        if (!this.settings.apiKey) {
            this.showNotification('Please set your DeepSeek API key in settings', 'warning');
            return;
        }

        if (this.keywords.length === 0) {
            this.showNotification('Add some keywords first to expand ad group', 'warning');
            return;
        }

        const button = event.target;
        this.setButtonLoading(button, true, 'Expanding...');

        try {
            const expansion = await this.callDeepSeekAPI(
                `Expand this ad group with 15 high-intent commercial keywords based on these core terms: ${this.keywords.slice(0, 3).join(', ')}. The new keywords should be highly relevant for a paid advertising campaign and indicate strong purchase intent. Return only the keywords, one per line.`
            );

            if (expansion) {
                const newKeywords = expansion.split('\n')
                    .map(k => k.trim())
                    .filter(k => k && !this.keywords.includes(k));

                this.showAIModal('Expanded Ad Group', newKeywords);
            }
        } catch (error) {
            console.error('Error expanding ad group:', error);
            this.showNotification('Error expanding ad group', 'error');
        } finally {
            this.setButtonLoading(button, false);
        }
    }

    async callDeepSeekAPI(prompt) {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.settings.apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    }

    // Export Functions
    async copyToClipboard() {
        if (this.keywords.length === 0) {
            this.showNotification('No keywords to copy', 'warning');
            return;
        }

        try {
            const text = this.keywords.join('\n');
            await navigator.clipboard.writeText(text);
            this.showNotification('Keywords copied to clipboard!', 'success');
        } catch (error) {
            console.error('Error copying to clipboard:', error);
            this.showNotification('Error copying to clipboard', 'error');
        }
    }

    downloadCSV() {
        if (this.keywords.length === 0) {
            this.showNotification('No keywords to export', 'warning');
            return;
        }

        const csvContent = 'Keyword\n' + this.keywords.map(k => `"${k}"`).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `matchmate-keywords-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification('CSV file downloaded!', 'success');
    }

    // UI Helper Functions
    showAIModal(title, keywords) {
        const modal = document.getElementById('aiSuggestionsModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContent = document.getElementById('modalContent');

        modalTitle.textContent = title;
        modalContent.innerHTML = '';

        if (keywords.length === 0) {
            modalContent.innerHTML = '<p>No suggestions were generated.</p>';
        } else {
            keywords.forEach((keyword, index) => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.innerHTML = `
                    <input type="checkbox" id="suggestion-${index}" value="${this.escapeHtml(keyword)}" checked>
                    <label for="suggestion-${index}">${this.escapeHtml(keyword)}</label>
                `;
                modalContent.appendChild(item);
            });
        }

        modal.showModal();
    }

    closeAIModal() {
        const modal = document.getElementById('aiSuggestionsModal');
        modal.close();
    }

    addSelectedKeywords() {
        const modalContent = document.getElementById('modalContent');
        const selectedKeywords = Array.from(modalContent.querySelectorAll('input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.value);

        if (selectedKeywords.length > 0) {
            this.importKeywords(selectedKeywords.join('\n'));
            this.showNotification(`Added ${selectedKeywords.length} keywords!`, 'success');
        }

        this.closeAIModal();
    }

    toggleSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    saveSettingsFromForm() {
        this.settings.fontFamily = document.getElementById('fontFamily').value;
        this.settings.fontSize = document.getElementById('fontSize').value;
        this.settings.fontColor = document.getElementById('fontColor').value;
        this.settings.apiKey = document.getElementById('apiKey').value;
        this.saveSettings();
    }

    setButtonLoading(button, isLoading, loadingText = 'Generating...') {
        if (isLoading) {
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = `<span>${loadingText}</span>`;
            button.classList.add('is-loading');
        } else {
            button.innerHTML = button.dataset.originalText;
            button.classList.remove('is-loading');
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            z-index: 10000;
            max-width: 200px;
            word-wrap: break-word;
            ${type === 'success' ? 'background: #e6f4ea; color: #137333; border: 1px solid #34a853;' : ''}
            ${type === 'error' ? 'background: #fce8e6; color: #d33b2c; border: 1px solid #ea4335;' : ''}
            ${type === 'warning' ? 'background: #fef7e0; color: #b06000; border: 1px solid #f9ab00;' : ''}
            ${type === 'info' ? 'background: #e8f0fe; color: #1a73e8; border: 1px solid #4285f4;' : ''}
        `;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.matchMate = new MatchMate();

    // Accordion logic
    document.querySelectorAll('.section-accordion').forEach((details) => {
        details.addEventListener('toggle', () => {
            if (details.open) {
                document.querySelectorAll('.section-accordion').forEach((otherDetails) => {
                    if (otherDetails !== details) {
                        otherDetails.removeAttribute('open');
                    }
                });
            }
        });
    });

    // Listen for updates from background script (e.g., keyword added/removed by content script)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'keywordsUpdated') {
            window.matchMate.loadKeywords(); // Reload keywords to update UI
        }
    });
});
