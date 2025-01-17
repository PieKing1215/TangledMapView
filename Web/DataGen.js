/*

Transition types:
bot: 123
left: 321
right: 288
top: 117
door: 20
door_*: 13

*/

 /** Loads data from the save file and hands general information about that data */
class DataGen {


	/** Map of item pool name => randomizer bool setting */
	static allItemPools = {
		// Get pool list from data: Object.keys(Object.values(data.rooms).map(x => Object.values(x.items)).flat().reduce((res, item) => {res[item.randPool] = true; return res}, {}))

		// See RandomizerMod.Randomization.ItemManager.GetRandomizedItems()
		Boss_Geo: "BossGeo",
		Charm: "Charms",
		Cocoon: "LifebloodCocoons",
		//Cursed: "RandomizeFocus",//
		//CursedNail: "CursedNail",//
		Dreamer: "Dreamers",
		Egg: "RancidEggs",
		Essence_Boss: "BossEssence",
		Flame: "GrimmkinFlames",
		Geo: "GeoChests",
		Grub: "Grubs",
		Key: "Keys",
		Lore: "LoreTablets",
		Map: "Maps",
		Mask: "MaskShards",
		Notch: "CharmNotches",
		Ore: "PaleOre",
		//PalaceLore: "RandomizePalaceTablets",//
		//PalaceSoul: "RandomizePalaceTotems",//
		Relic: "Relics",
		Rock: "GeoRocks",
		Root: "WhisperingRoots",
		Skill: "Skills",
		Soul: "SoulTotems",
		Stag: "Stags",
		Vessel: "VesselFragments",
		//note we have pools for SplitClaw, SplitCloak, and SplitCloakLocation that aren't in that list
	}

	// centerPos = [0, 0]
	rooms = {}//map of room id => RoomNode
	transitions = {}//map of (srcDoor) => RoomTransition
	/** Map of door id => RoomTransition. The forward transition is preferred, but if there isn't one the reverse transition is used. */
	doorTransitions = {}
	/** set of doors we've used including src and dst door, door id => true */
	visitedDoors = {}

	/** Map of pool name => true for items pools active in our save file */
	itemPools = {}
	/**
	 * Map of item id => true or false if we have it or not
	 * NB: this is the item we got, NOT necessarily where it is in the world.
	 */
	items = {}
	/**
	 * What item is at each given item location (NB: K/V is swapped from randomizerData["StringValues"]["_itemPlacements"])
	 * Map of item id (some item's original location) => item id for item that is there (after randomization)
	 */
	itemPlacements = {}

	/** Map of item id => mapData information about that item */
	allItems = {}

	currentPlayerRoom = "Tutorial_01"
	selectedRoom = null
	startRoom = "Tutorial_01"

	/** Show all rooms? If false just what we've visited. */
	showAllRooms = false
	/** Spoil what items are */
	showAllItems = false

	clusterBasedOnAll = true

	clear() {
		this.saveData = null
		this.randomizerData = null
		this.randomizerCtx = null
		this.transitions = {}
		this.visitedDoors = {}
		this.rooms = {}
		this.itemPools = {}
		this.items = {}
		this.itemPlacements = {}
		this.selectedRoom = null
	}

	static inflate(kvString) {
		if (!kvString) return {}

		let data = JSON.parse(kvString)
		let ret = {}
		for (let i = 0; i < data._keys.length; ++i) {
			ret[data._keys[i]] = data._values[i]
		}
		return ret
	}

	load(saveData) {
		this.saveData = saveData
		var randomizerDataJSON = saveData["PolymorphicModData"]["RandomizerMod"]
		this.randomizerData = JSON.parse(randomizerDataJSON)
		var randomizerCtxJSON = saveData["PolymorphicModData"]["context"]
		this.randomizerCtx = JSON.parse(randomizerCtxJSON)

		this.startRoom = this.randomizerCtx.StartDef.SceneName
		this.currentPlayerRoom = this.startRoom //if we wanted to send more data could read from save file, but nah

		this.transitions = {}
		this.visitedDoors = {}
		this.rooms = {}


		this._buildDoors()

		this._markVisitedTransitions()

		for (let roomId in this.rooms) {
			this.rooms[roomId].finishSetup()
		}

		//item pools
		this.itemPools = {}
		for (let k in DataGen.allItemPools) {
			let saveKey = DataGen.allItemPools[k]
			if (this.randomizerData["GenerationSettings"]["PoolSettings"][saveKey]) this.itemPools[k] = true
		}

		//items
		this.itemPlacements = this.randomizerCtx["itemPlacements"] || {}
		//flip src/dst
		this.itemPlacements = Object.fromEntries(Object.entries(data.randomizerCtx.itemPlacements).map(a => [a[1].Location.LocationDef.Name, a[1].Item.ItemDef.Name]))
		this.items = this.randomizerData["TrackerData"]["obtainedItems"] || {}

		//all items list
		this.allItems = {}
		for (let room of [...Object.values(this.rooms), window.mapData.rooms.__orphans__]) {
			for (let itemId in room.items) {
				let item = room.items[itemId]
				item.id = itemId
				this.allItems[item.id] = item
			}
		}
	}

	/** Given a room and door name (e.g. right1), returns the split index that door is in on that room (usually 0). */
	_getSplit(room, doorSide) {
		let splitRoom = room.mapData.splitRoom
		if (!splitRoom || !splitRoom.length) return 0

		let split = 0
		for (; split < splitRoom.length; ++split) {
			if (splitRoom[split].indexOf(doorSide) >= 0) {
				return split
			}
		}

		console.error("Door not in split room list", doorSide, room)
		return 0
	}

	_buildDoors() {
		const getAndUpdateRoom = (roomId, doorId) => {
			var room = this.rooms[roomId] || (this.rooms[roomId] = new RoomNode(roomId, this))
			room.addDoor(doorId)
			return room
		}

		// map of doorId => doorId
		var tPlacements = {}

		//first fill with standard transitions
		for (let roomId in window.mapData.rooms) {
			let roomData = window.mapData.rooms[roomId]
			for (let doorSide in roomData.transitions) {
				let doorInfo = roomData.transitions[doorSide]
				if (doorInfo.to) tPlacements[`${roomId}[${doorSide}]`] = doorInfo.to
			}
		}

		//Then update with any transitions that have been randomized:
		let randomizedPlacements = Object.fromEntries(Object.entries(this.randomizerCtx.transitionPlacements).map(a => [a[1].Source.Name, a[1].Target.Name]))
		for (let srcDoorId in randomizedPlacements) {
			if (!tPlacements[srcDoorId]) {
				//Not in the original map data, so skip (e.g. Fungus2_14[bot2] and bot3 which are redundant and not included)
				console.warn("No initial door for " + srcDoorId)
				continue
			}
			tPlacements[srcDoorId] = randomizedPlacements[srcDoorId]
		}

		console.log("tPlacements", tPlacements)


		// Build doors, transitions, and such
		for (let roomId in window.mapData.rooms) {
			let roomData = window.mapData.rooms[roomId]

			for (let doorName in roomData.transitions) {
				let srcDoor = `${roomId}[${doorName}]`
				let srcInfo = DataGen.parseDoorId(srcDoor)
				let dstDoor = tPlacements[srcDoor]
				if (!dstDoor) continue

				let dstInfo = DataGen.parseDoorId(dstDoor)
				if (!window.mapData.rooms[dstInfo.roomId]) {
					console.warn("No such room " + dstInfo.roomId)
					continue
				}

				let srcRoom = getAndUpdateRoom(srcInfo.roomId, srcDoor)
				let dstRoom = getAndUpdateRoom(dstInfo.roomId, dstDoor)

				this.transitions[srcDoor] = Object.assign(new RoomTransition, {
					id: srcDoor + "-" + dstDoor,

					srcDoor,
					srcRoom,
					srcSide: srcInfo.side,
					srcSplit: this._getSplit(srcRoom, srcInfo.doorName),

					dstDoor,
					dstRoom,
					dstSide: dstInfo.side,
					dstSplit: this._getSplit(dstRoom, dstInfo.doorName),

					randomized: !!randomizedPlacements[srcDoor],

					visited: null,//will fill out shortly
					bidi: tPlacements[dstDoor] === srcDoor,//bidirectional link
				})
			}
		}

		this.doorTransitions = {}
		//add door mappings
		for (let k in this.transitions) {
			var transition = this.transitions[k]
			this.doorTransitions[transition.srcDoor] = transition
			if (!transition.bidi) this.doorTransitions[transition.dstDoor] = transition
		}
	}

	_markVisitedTransitions() {
		let markVisited = (transitionA) => {
			transitionA.visited = true
			this.visitedDoors[transitionA.srcDoor] = true
			this.visitedDoors[transitionA.dstDoor] = true

			if (transitionA.bidi) {
				let transitionB = this.doorTransitions[transitionA.dstDoor]
				transitionB.visited = true
			}
		}

		var obtainedTransitions = this.randomizerData["TrackerData"]["visitedTransitions"]

		//mark what's been visited from _obtainedTransitions)
		for (let doorId in obtainedTransitions) {
			let transitionA = this.doorTransitions[doorId]
			markVisited(transitionA)
		}

		//_obtainedTransitions only records randomized transitions, not unrandomized taken transitions
		//so mark those too
		//note we don't blindy link any connections between scenesVisited as you may not have taken that
		//transition and don't actually know they connect (but if you don't have those rooms randomized and you've
		//been in both you "know" they connect because we assume your base game knowledge is perfect)
		let visitedScenesSet = Object.fromEntries(this.saveData.playerData.scenesVisited.map(x => [x, true]))
		for (let roomId of this.saveData.playerData.scenesVisited) {
			let room = this.rooms[roomId]
			if (!room) continue // not every room you can enter is handled by this map
			for (let doorId in room.doors) {
				let transition = this.transitions[doorId]
				if (!transition) continue //one-way entrance, which we alway treat as "visited"

				if (!transition.randomized && visitedScenesSet[transition.dstRoom.id]) {
					//not randomized, been in both rooms
					markVisited(transition)
				}
			}
		}
	}

	/** Returns the item id that can be found at the given source item location. */
	getItemAt(locationItemId) {
		return this.itemPlacements[locationItemId] || locationItemId
	}

	/** Returns the item index that can be found at the given source item location. */
	getItemIndexAt(locationItemId) {
		return this.randomizerCtx.itemPlacements.findIndex(e => e.Location.LocationDef.Name == locationItemId)
	}

	/** Returns true if we should reveal to the user what item is at the given location. */
	shouldRevealItemAt(locationItemId) {
		if (this.showAllItems) return true
		return this.hasItemAt(locationItemId)
	}

	/** true/false if we have the item (whatever it is) that's located at the given item id location */
	hasItemAt(locationItemId) {
		let itemId = this.getItemIndexAt(locationItemId)
		return this.items.includes(itemId)
	}

	/** Marks the given item (not location) as collected. */
	markItemAcquired(itemId) {
		this.items[itemId] = true
	}

	/** Returns data from mapData about the item that's normally at the given item location. */
	getNormalItemInfo(itemId) {
		if (itemId.endsWith("_(1)")) {
			itemId = itemId.substring(0, itemId.length - 4)
		}

		let item = this.allItems[itemId] || null
		if (!item) console.warn("No item: " + itemId)
		return item
	}

	getRoomGraph(allRooms = false, splitSplitRooms = true) {
		let ret = window.createGraph()

		let transitionList = allRooms ? Object.values(this.transitions) : Object.values(this.visibleTransitions)

		if (splitSplitRooms) {
			for (let transition of transitionList) {
				ret.addLink(transition.srcRoomSplitId, transition.dstRoomSplitId)
			}
		} else {
			for (let transition of transitionList) {
				ret.addLink(transition.srcRoom.id, transition.dstRoom.id, transition)
			}
		}

		return ret
	}

	get visibleRoomGraph() {
		return this.getRoomGraph(false, true)
	}

	get allRoomGraph() {
		return this.getRoomGraph(true, true)
	}


	static parseDoorId(doorId) {
		var parts = doorId.match(/^(\w+)\[(([a-zA-Z_]+)(\d*))\]$/)

		var ret = {
			doorId,// Town[left1]
			roomId: parts[1], // Town
			doorName: parts[2], // left1
			side: parts[3], // left
			number: parts[4] || -1, // 1
		}

		let info = window.mapData.rooms[ret.roomId].transitions[ret.doorName]
		if (info && info.side) ret.side = info.side

		return ret
	}

	/** Returns a map of rooms that are currently visible (roomId => room) */
	get visibleRooms() {
		if (this.showAllRooms) {
			return this.rooms
		} else {
			//just what we've visited
			//can't use this.saveData.playerData.scenesVisited, not all rooms get recorded (e.g. White_Palace*)
			var ret = {}

			for (let doorId in this.visitedDoors) {
				if (ret[doorId]) continue;

				var transition = this.doorTransitions[doorId]
				ret[transition.srcRoom.id] = transition.srcRoom
				ret[transition.dstRoom.id] = transition.dstRoom
			}

			return ret
		}
	}

	/** Returns a map of visible transitions (srcDoor (or maybe dstDoor) => transition) */
	get visibleTransitions() {
		if (this.showAllRooms) {
			return this.doorTransitions
		} else {
			var ret = {}
			for (let doorId in this.visitedDoors) {
				var transition = this.doorTransitions[doorId]
				ret[transition.srcDoor] = transition
				if (transition.bidi) {
					var transitionB = this.transitions[transition.dstDoor]
					ret[transitionB.srcDoor] = transitionB
				} else {
					ret[transition.dstDoor] = transition
				}
			}

			return ret
		}
	}

	/** Indicates that the player has entered a room via the given doorId and we should update accordingly. */
	addVisit(doorId) {
		var transition = this.doorTransitions[doorId]
		this.visitedDoors[transition.srcDoor] = true
		this.visitedDoors[transition.dstDoor] = true
	}

}

class RoomNode {
	doors = {}//map of door id => {x, y, ...parseDoorId()} that leave this room
	items = {}//map of item id => item info or items in this room
	numDoors = 0
	island = null
	islandDistance = 0//0 = hub, 1 = adjacent to hub, 2 = adjacent to that, etc.
	graphParent = null//an adjacent room on our island that's closer to the hub than us
	/** Bounding box, in local coordinates, center of that, width and height of that, radius of a circle that touches the rectangle edges. */
	aabb = {x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity, cx: null, cy: null, width: null, height: null, radius: null}
	mapData = {}

	constructor(id, data) {
		this.id = id
		this.data = data

		this.mapData = window.mapData.rooms[id] || {}
	}

	addDoor(doorId) {
		this.doors[doorId] = DataGen.parseDoorId(doorId)
		this.numDoors = Object.keys(this.doors).length
	}

	finishSetup() {
		//how big to make a room if we don't have data for its doors
		const defaultSize = 30
		const defaultSize2 = defaultSize / 2

		if (this.numDoors === 0) {
			this._calcAABBData(-defaultSize2, -defaultSize2)
			this._calcAABBData(defaultSize2, defaultSize2)
			this._calcAABBData()
			return
		}

		var b = this.aabb
		let sidesArray = Object.keys(this.doors).map(x => x.side)

		//Check for door positions we know about
		var unknownDoorCount = 0
		var allRoomData = window.mapData.rooms
		for (let doorId in this.doors) {
			let door = this.doors[doorId]

			if (!allRoomData[door.roomId] || !allRoomData[door.roomId].transitions[door.doorName]) {
				++unknownDoorCount
				continue
			}
			var info = allRoomData[door.roomId].transitions[door.doorName]
			this.doors[doorId].x = info.x
			this.doors[doorId].y = -info.y
			this._expandAABB(info.x, -info.y)
		}

		//make room big enough for unknown doors
		if (unknownDoorCount > 0) {
			let hCount = sidesArray.filter(x => x === "left" || x === "right").length
			let vCount = sidesArray.filter(x => x === "top" || x === "bot").length
			if (hCount) {
				this._expandAABB(-defaultSize2 * hCount, NaN)
				this._expandAABB(defaultSize2 * hCount, NaN)
			}
			if (vCount) {
				this._expandAABB(-defaultSize2 * vCount, NaN)
				this._expandAABB(defaultSize2 * vCount, NaN)
			}
		}

		//include items
		this.items = {...allRoomData[this.id].items}
		for (let itemId in this.items) {
			let item = this.items[itemId] = {...this.items[itemId]}
			item.y *= -1
			item.id = itemId
			this._expandAABB(item.x, item.y)
		}

		//include benches
		this.benches = [...allRoomData[this.id].benches]
		for (let bench of this.benches) {
			bench.y *= -1
			this._expandAABB(bench.x, bench.y)
		}

		this._calcAABBData()

		//Make room at least minimum width/height, keeping in mind the local origin may not be included
		if (b.width < defaultSize) {
			if (b.x1 === Infinity && b.x2 === -Infinity) b.x1 = -defaultSize2, b.x2 = defaultSize2
			else if (b.x1 === Infinity) b.x1 = b.x2 - defaultSize
			else if (b.x2 === -Infinity) b.x2 = b.x1 + defaultSize
			else {
				let axisDoors = sidesArray.filter(x => x === "left" || x === "right")
				if (axisDoors.length === 1) {
					if (axisDoors[0] === "left") b.x2 = b.x1 + defaultSize
					else b.x1 = b.x2 - defaultSize
				} else {
					let c = (b.x1 + b.x2) / 2
					b.x1 = c - defaultSize2
					b.x2 = c + defaultSize2
				}
			}
		}
		if (b.height < defaultSize) {
			if (b.y1 === Infinity && b.y2 === -Infinity) b.y1 = -defaultSize2, b.y2 = defaultSize2
			else if (b.y1 === Infinity) b.y1 = b.y2 - defaultSize
			else if (b.y2 === -Infinity) b.y2 = b.y1 + defaultSize
			else {
				let axisDoors = sidesArray.filter(x => x === "top" || x === "bot")
				if (axisDoors.length === 1) {
					if (axisDoors[0] === "left") b.y2 = b.y1 + defaultSize
					else b.y1 = b.y2 - defaultSize
				} else {
					let c = (b.y1 + b.y2) / 2
					b.y1 = c - defaultSize2
					b.y2 = c + defaultSize2
				}
			}
		}

		this._calcAABBData()

		//add unknown doors to edges is maybe plausible locations
		if (unknownDoorCount > 0) {
			for (let doorId in this.doors) {
				let door = this.doors[doorId]
				if (typeof door.x === "number") continue

				let numThatSide = sidesArray.filter(x => x === door.side).length
				let posNorm = numThatSide === 1 ? .5 : (door.number - 1) / (numThatSide - 1)
				switch (door.side) {
					case "top": door.x = b.x1 + posNorm * b.width, door.y = b.y1; break
					case "bot": door.x = b.x1 + posNorm * b.width, door.y = b.y2; break
					case "left": door.y = b.y1 + posNorm * b.height, door.x = b.x1; break
					case "right": door.y = b.y1 + posNorm * b.height, door.x = b.x2; break
					default: door.x = door.y = 0; break
				}

			}
		}
	}

	_expandAABB(x, y) {
		var b = this.aabb
		if (!isNaN(x)) {
			b.x1 = Math.min(b.x1, x)
			b.x2 = Math.max(b.x2, x)
		}
		if (!isNaN(y)) {
			b.y1 = Math.min(b.y1, y)
			b.y2 = Math.max(b.y2, y)
		}
	}

	_calcAABBData() {
		var b = this.aabb
		b.width = b.x2 - b.x1
		b.height = b.y2 - b.y1
		b.cx = b.x1 + b.width / 2
		b.cy = b.y1 + b.height / 2
		let x = b.width / 2, y = b.height / 2
		b.radius = Math.sqrt(x * x + y * y)
	}

	get isStartRoom() {
		return this.id === this.data.startRoom
	}

	get isEveryTransitionVisited() {
		let visitedDoors = this.data.visitedDoors
		for (let k in this.doors) {
			if (!visitedDoors[k]) return false
		}
		return true
	}

	get visitedDoors() {
		let allVisited = this.data.visitedDoors
		let ret = []
		for (let k in this.doors) if (allVisited[k]) ret.push(k)
		return ret
	}
	get unvisitedDoors() {
		let allVisited = this.data.visitedDoors
		let ret = []
		for (let k in this.doors) if (!allVisited[k]) ret.push(k)
		return ret
	}

	get numTransitionsVisited() {
		let visitedDoors = this.data.visitedDoors
		let ret = 0
		for (let k in this.doors) {
			if (visitedDoors[k]) ++ret
		}
		return ret
	}

	get adjacentRooms() {
		//(aside: rooms can link to themselves, FYI)
		var ret = []
		for (let doorId in this.doors) {
			let transition = this.data.doorTransitions[doorId]
			if (transition.srcRoom !== this && ret.indexOf(transition.srcRoom) < 0) ret.push(transition.srcRoom)
			if (transition.dstRoom !== this && ret.indexOf(transition.dstRoom) < 0) ret.push(transition.dstRoom)
		}
		return ret
	}

	get adjacentVisibleRooms() {
		//(aside: rooms can link to themselves, FYI)
		var visibleTransitions = this.data.visibleTransitions
		var ret = []
		for (let doorId in this.doors) {
			let transition = visibleTransitions[doorId]
			if (!transition) continue
			if (transition.srcRoom !== this && ret.indexOf(transition.srcRoom) < 0) ret.push(transition.srcRoom)
			if (transition.dstRoom !== this && ret.indexOf(transition.dstRoom) < 0) ret.push(transition.dstRoom)
		}
		return ret
	}

	get displayText() {
		return this.id
	}

	/** True if we are an island hub */
	get isHub() {
		return this.island && this.island.hub === this
	}
}

/** A transition from room A to room B. Might have a brother that's for room B to A. */
class RoomTransition {
	id = ""
	srcDoor = ""
	srcRoom = ""
	srcSide = ""
	/** Split index. Usually 0, but may be more if the source room is a split room (can't get to all doors from any door). */
	srcSplit = 0

	dstDoor = ""
	dstRoom = ""
	dstSide = ""
	/** Same as srcSplit, but for destination door */
	dstSplit = 0

	/** Different transition in this save file than the base game? */
	randomized = false

	visited = false
	bidi = false

	/** Returns the room on this transition that isn't the given one. */
	otherRoom(room) {
		if (this.srcRoom === room) return this.dstRoom
		else if (this.dstRoom === room) return this.srcRoom
		else throw new Error("Room is unrelated")
	}

	otherDoor(doorId) {
		if (this.srcDoor === doorId) return this.dstDoor
		else if (this.dstDoor === doorId) return this.srcDoor
		else throw new Error("Door is unrelated")
	}

	get srcRoomSplitId() {
		if (this.srcSplit === 0) return this.srcRoom.id
		else return this.srcRoom.id + "." + this.srcSplit
	}

	get dstRoomSplitId() {
		if (this.dstSplit === 0) return this.dstRoom.id
		else return this.dstSplit.id + "." + this.dstSplit
	}

}
/** A connecting line between rooms on the map. Only one link even if it covers two transitions.  */
class RoomLink {

	static getId(transition) {
		return [transition.srcDoor, transition.dstDoor].sort().join("-")
	}

	constructor(transitionA, transitionB) {
		//id is door id + "-" + door id, with the alphabetically first one first
		this.id = RoomLink.getId(transitionA)

		this.transitionA = transitionA
		//optional, but if given must be transitionA with src and dst swapped
		this.transitionB = transitionB

		this.source = transitionA.srcRoom
		this.target = transitionA.dstRoom

		//Try to cluster near nexus rooms and allow larger distances for "straight-though"/travel rooms.
		var mostDoors = Math.max(transitionA.srcRoom.numDoors, transitionA.dstRoom.numDoors)
		this.strength = Math.pow(mostDoors, 1.2) / 30

	}

}
