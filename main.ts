/* Credits to Obsidian-Swither-Plus https://github.com/darlal/obsidian-switcher-plus/ for fuzzySearch use outside Modals */

import { App, Editor, fuzzySearch, FuzzyMatch, FuzzySuggestModal, ItemView, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, PreparedQuery, prepareQuery, SearchResultContainer, Setting, sortSearchResults, SuggestModal, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import { getAPI } from 'obsidian-dataview';

const properties = /---{}*---/;
const ingredientProperties = /Ingredients:[\r\n]+  - "{}"/;

interface Suggestion<T> extends FuzzyMatch<T> {
	type: "food";
	file: TFile;
	downranked?: boolean;
}

interface FoodSugggestionContainer extends Omit<Suggestion<Ingredient>, 'file'> {
}

  
// Remember to rename these classes and interfaces
interface FoodManagerSettings {
	FoodNutritionDatabase: string,
	FoodPortionDatabase: string,
}

const DEFAULT_SETTINGS: FoodManagerSettings = {
	FoodNutritionDatabase: 'NutritionAbregee.csv',
	FoodPortionDatabase: 'PortionFruits_Legumes.csv',
}

interface Ingredient {
	name: string;
}

interface NutrientsObject {
	alim_code: number;
	alim_nom_fr: string;
	energie_kj: number;
	energie_kcal: number;
	glucides: number;
	sucres: number;
	fibres: number;
	lipides: number;
	ag_satures: number;
	proteines: number;
	sel: number;
}

export const VIEW_TYPE_EXAMPLE = "example-view";

export class RecipeeView extends ItemView {
  settings: FoodManagerSettings
  constructor(leaf: WorkspaceLeaf, settings: FoodManagerSettings) {
    super(leaf);
	this.settings = settings;
  }

  getViewType() {
    return VIEW_TYPE_EXAMPLE;
  }

  getDisplayText() {
    return "Recipee";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
	this.icon = "chef-hat";

    container.empty();
    container.createEl("h4", { text: "Recipee" });
	let createRecipee = container.createEl("button", { text: "Create Recipee" });
	createRecipee.onclick = (() => {
		new RecipeeCreation(this.app, this.settings).open();
	});
  }

  async onClose() {
    // Nothing to clean up.
  }

	displayMatchingIngredients(input: string, display: HTMLElement){
		if(input === ""){
			display.innerText = "";
			return;
		}

		let matchList = fuzzyIngredientMatch(input, this.foodData);
		display.innerText = matchList.slice(0,5).map((value) => value.item.name).join("\n");
	}
}

export default class FoodManagerPlugin extends Plugin {
	settings: FoodManagerSettings;
	foodData: Ingredient[];

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'add-recipee',
			name: 'Add new recipee',
			callback: () => {
				new RecipeeCreation(this.app, this.settings).open();
			}
		});

		this.addCommand({
			id: 'find-ingredient',
			name: 'Find Ingredient in Database',
			callback: () => {
				new IngredientSuggestion(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'custom-fuzzy',
			name: 'Custom manual fuzzy search',
			callback: () => {
				let matchList = [] as FoodSugggestionContainer[];
				let pQ = prepareQuery("Boeuf") as PreparedQuery;
				this.foodData.forEach( item => {
					let match = fuzzySearch(pQ, item.name)
					if (match) matchList.push({ type: "food", item, match: match });
				});
				sortSearchResults(matchList);
				console.log(matchList)
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_EXAMPLE,
			(leaf) => new RecipeeView(leaf, this.settings)
		);
	
		this.addRibbonIcon("chef-hat", "Activate view", () => {
			this.activateView();
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		let dvAPI = getAPI(this.app);
		let result = await dvAPI.io.csv(this.settings.FoodNutritionDatabase);

		this.foodData = result.map((r: NutrientsObject) => { return { name: r.alim_nom_fr } }).values;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	
	async activateView() {
		const { workspace } = this.app;
	
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_EXAMPLE);
	
		if (leaves.length > 0) {
		  // A leaf with our view already exists, use that
		  leaf = leaves[0];
		} else {
		  // Our view could not be found in the workspace, create a new leaf
		  // in the right sidebar for it
		  leaf = workspace.getRightLeaf(false);
		  await leaf?.setViewState({ type: VIEW_TYPE_EXAMPLE, active: true });
		}
	
		// "Reveal" the leaf in case it is in a collapsed sidebar
		if(leaf != null) workspace.revealLeaf(leaf);
	}
}


class IngredientSuggestion extends FuzzySuggestModal<Ingredient>{
	plugin: FoodManagerPlugin;

	constructor(app: App, plugin: FoodManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	getItems(): Ingredient[] {
		return this.plugin.foodData;
	}

	getItemText(ingredient: Ingredient): string {
		return ingredient.name;
	}

	onChooseItem(ingredient: Ingredient, evt: MouseEvent | KeyboardEvent) {
		const currentEditor = this.app.workspace.activeEditor?.editor;
		if(currentEditor != undefined)
			currentEditor.replaceSelection(ingredient.name);
		new Notice(`Adding ${ingredient.name}`);
	}
}

class StrictIngredientSuggestion extends SuggestModal<Ingredient>{
	plugin: FoodManagerPlugin;

	constructor(app: App, plugin: FoodManagerPlugin) {
		super(app);
		this.plugin = plugin;
	}
	
	// Returns all available suggestions.
	getSuggestions(query: string): Ingredient[] {
		return this.plugin.foodData.filter((ingredient) =>
			ingredient.name.toLowerCase().includes(query.toLowerCase())
		);
	}

	// Renders each suggestion item.
	renderSuggestion(ingredient: Ingredient, el: HTMLElement) {
		el.createEl("div", { text: ingredient.name });
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(ingredient: Ingredient, evt: MouseEvent | KeyboardEvent) {
		new Notice(`Selected ${ingredient.name}`);
	}
}

class RecipeeCreation extends Modal {
	settings: FoodManagerSettings
	recipeeName: HTMLInputElement;
	ingredientList : HTMLElement;

	constructor(app: App, settings: FoodManagerSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.classList.add("recipeeForm");

		let title = contentEl.createEl("h1", { text: "New recipee" });
		this.recipeeName = this.addRecipeeNameInput(contentEl);
		
		contentEl.createEl("hr");

		let fields = contentEl.createDiv();
		fields.classList.add("ingredients");
		
		this.addIngredientLabels(fields);
		this.ingredientList = fields.createDiv();
		this.ingredientList.classList.add("ingredientList");
		this.addIngredientInput(null, this.ingredientList);
		this.addCreationButton(contentEl);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}

	addRecipeeNameInput(parent: HTMLElement) : HTMLInputElement {
		let recipeeName = parent.createDiv();
		recipeeName.classList.add("recipeeName");
		
		recipeeName.createEl("label", {text: "Name"});
		let recipeeNameValue = recipeeName.createEl("input");

		return recipeeNameValue
	}

	addIngredientLabels(parent: HTMLElement){
		let labels = parent.createDiv();
		labels.classList.add("ingredientLabels");

		let nameLabel = labels.createEl("label", {text: "Ingredient"});
		let quantityLabel = labels.createEl("label", {text: "Quantity"});
		
		nameLabel.classList.add("name");
		quantityLabel.classList.add("quantity");
	}

	addIngredientInput(button: HTMLButtonElement | null, parent: HTMLElement){
		let inputIngredient = parent.createEl("input", {text: "ingredient"});
		let inputQuantity = parent.createEl("input", {text: "quantity"});

		inputIngredient.classList.add("name");
		inputQuantity.classList.add("quantity");

		let newAddButton = parent.createEl("button", { text: "+" });
		newAddButton.onclick = (() => {this.addIngredientInput(newAddButton, parent)});

		if(button) button.remove();
	}

	addCreationButton(parent: HTMLElement){
		let bottom = parent.createDiv();
		let createRecipee = createEl("button", { text: "Create" });

		createRecipee.onclick = (() => this.createRecipee());
		
		bottom.appendChild(createRecipee);
	}

	async createRecipee(){
		let ingredientList = []
		let recipeeTitle = this.recipeeName.value;

		for(let i = 0; i < this.ingredientList.children.length - 1; i+=2) {
			let ingredientName = this.ingredientList.children[i] as HTMLInputElement;
			let ingredientQuantity = this.ingredientList.children[i+1] as HTMLInputElement;
			ingredientList.push([ingredientName.value +": "+ ingredientQuantity.value]);
		};

		let file = this.app.metadataCache.getFirstLinkpathDest("Templates/Recipe_personal_template", ".");
		if(file) {
			let recipe = await this.app.vault.read(file);
			console.log(recipe);
			let updatedContent = recipe.replace(ingredientProperties, "Ingredients:\n  " + ingredientList.join('\n  ') );
			this.app.vault.create("Recettes/" + recipeeTitle + ".md", updatedContent);
		}
		this.close();
		new Notice("Recipee Created");
	}
}

class SettingTab extends PluginSettingTab {
	plugin: FoodManagerPlugin;

	constructor(app: App, plugin: FoodManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Food Nutrients Database path')
			.addText(text => text
				.setPlaceholder('Path')
				.setValue(this.plugin.settings.FoodNutritionDatabase)
				.onChange(async (value) => {
					this.plugin.settings.FoodNutritionDatabase = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Food Portions Database path')
			.addText(text => text
				.setPlaceholder('Path')
				.setValue(this.plugin.settings.FoodPortionDatabase)
				.onChange(async (value) => {
					this.plugin.settings.FoodPortionDatabase = value;
					await this.plugin.saveSettings();
				}));

	}
}

function fuzzyIngredientMatch(input: string, foodData: Ingredient[]): FoodSugggestionContainer[] {
	let matchList = [] as FoodSugggestionContainer[];
	let pQ = prepareQuery(input) as PreparedQuery;
	
	foodData.forEach( item => {
		let match = fuzzySearch(pQ, item.name)
		if (match) matchList.push({ type: "food", item, match: match });
	});
	
	sortSearchResults(matchList);
	return matchList;
}