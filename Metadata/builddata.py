"""
Looks thorugh assorted data files and puts together a big master file of
map/game (meta)data we need for mapping.

Including:
	- RandomizerMod data
	- roomMeta.yaml
	- scene source files

"""
import sys, os, io
import json

import yaml

# local modules:
import config, unityScene, roomInfo

roomInfo.loadData()

handler = unityScene.SceneHandler()
testing = False

# testing = True
testScenes = [
	# "Town",
	# "Room_Bretta",
	# "Tutorial_01",
	# "Abyss_06_Core",
	# "Fungus2_05",
	"Room_Colosseum_Silver",
]


if __name__ == "__main__":
	skipRooms = (
		"BetaEnd", "Opening_Sequence", "Beta", "Pre_Menu_Intro", "PermaDeath_Unlock", "Quit_To_Menu",
		"Dream_Room_Believer_Shrine", "Dream_Backer_Shrine", "Room_Jinn",
	)
	ggIncludes = ("GG_Lurker", "GG_Pipeway", "GG_Waterways")

	for root, dirs, files in os.walk(config.scenesPath):
		for file in files:
			if not file.endswith(".unity"): continue
			if file.startswith("Cinematic"): continue
			roomId = file[:-6]
			if roomId in skipRooms: continue
			if file.startswith("Cutscene"): continue
			if file.startswith("End"): continue
			if file.startswith("Menu"): continue
			if roomId.startswith("GG_") and roomId not in ggIncludes: continue
			if root.endswith("Bosses") and file.startswith("GG_"): continue

			if testing and roomId not in testScenes: continue

			print("Room " + roomId)
			roomData = roomInfo.getRoom(roomId)

			handler.loadFile(roomId, root + "/" + file)
			handler.addInfo(roomData)

			if testing: print(yaml.dump(roomData))

	if not testing:
		# print(repr(roomInfo.roomData))
		with open("../Web/mapData.js", "w") as f:
			f.write("//This file is automatically generated by builddata.py, don't edit\n")
			f.write("window.mapData = ")
			json.dump(roomInfo.metaData, f, indent="\t", sort_keys=True)
