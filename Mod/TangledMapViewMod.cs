﻿
using System;
using System.Collections;
using System.Reflection;
using Modding;
using Modding.Patches;
using MonoMod.RuntimeDetour;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RandomizerMod;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;


//namespace Modding.Patches
//{
//	class patch_GameManager : global::GameManager
//	{
//		public extern void orig_BeginSceneTransition(GameManager.SceneLoadInfo info);

//		public void BeginSceneTransition(GameManager.SceneLoadInfo info)
//		{
//			TangledMapView.TangledMapViewMod.Instance.OnBeginSceneTransition(info);

//			orig_BeginSceneTransition(info);
//		}
//	}
//}

namespace TangledMapView {

public class TangledMapViewMod : Mod {
	public static TangledMapViewMod Instance { get; private set; }

	internal MapServer server;

	//private delegate void GiveItem_Fn(GiveAction action, string item, string location, int geo = 0);
	//private delegate void BeginSceneTransition_Fn(GameManager self, GameManager.SceneLoadInfo info);

	// public SaveGameData activeSaveData;
	private bool saveLoaded, startingSave;
	//private RandomizerMod.RandomizerMod rndMod;
	//private Hook itemHook;
	//private Hook startNewGameHook;
	private Hook transitionHook;
	public string CurrentRoom { get; private set; }

	public TangledMapViewMod() : base("TangledMapView") { }

	public override int LoadPriority() {
		return 100;//want randomizer to load before us
	}


	public override void Initialize() {
		base.Initialize();
		Instance = this;

		//Make an object to help us do things:
		var go = new GameObject("TangledMapManager", typeof(TangledMapManager));
		var tmm = go.GetComponent<TangledMapManager>();
		tmm.mod = this;
		Object.DontDestroyOnLoad(go);

		//rndMod = RandomizerMod.RandomizerMod.Instance;

		RandomizerMod.IC.TrackerUpdate.OnItemObtained += OnGiveItem;
		//add hook to watch when the randomizer gives the player an item
		//	itemHook = new Hook(//(GiveItemActions is a static class, so we pass a generic "object" for "this"
		//	typeof(GiveItemActions).GetMethod(nameof(GiveItemActions.GiveItem), BindingFlags.Static | BindingFlags.Public),
		//	typeof(TangledMapViewMod).GetMethod(nameof(OnGiveItem), BindingFlags.Static | BindingFlags.NonPublic)
		//);

		//	GameManager.Beg
		//ModHooks.BeforeSceneLoadHook += OnBeginSceneTransition;
		On.GameManager.BeginSceneTransition += OnBeginSceneTransition;

		UnityEngine.SceneManagement.SceneManager.sceneLoaded += OnSceneLoaded;

		ModHooks.AfterSavegameLoadHook += data => {
			Log("get load");
			saveLoaded = true;
			string saveData = PrepareSaveDataMessage();
			Instance.Log($"saveData= {saveData}");
			server.Send(saveData);
		};

		On.UIManager.StartNewGame += (orig, self, death, rush) => {
			Log("got StartNewGame");
			startingSave = true;//we will actually push data once a scene loads
			orig(self, death, rush);
		};

		Log("done init");
		//note: ModHooks.Instance.NewGameHook not called, likely because the randomizer mod overrides how a game is started
	}

	private static void OnGiveItem(int id, string item, string location) {
		//orig(action, item, location, geo);
		Instance.Log($"GiveItem hook: {id}, {item}, {location}");

		Instance.server.Send(JToken.FromObject(new {
			type = "getItem",
			item, location,
		}).ToString());
	}

	private void OnBeginSceneTransition(On.GameManager.orig_BeginSceneTransition orig, GameManager self, GameManager.SceneLoadInfo info)
	{
		Log($"OnBeginSceneTransition: to {info.SceneName}[{info.EntryGateName}]");
		if (!string.IsNullOrEmpty(info.SceneName) && !string.IsNullOrEmpty(info.EntryGateName))
		{
			server.Send("revealTransition", "to", $"{info.SceneName}[{info.EntryGateName}]");
		}

		orig(self, info);
	}

	private void OnSceneLoaded(Scene scene, LoadSceneMode mode) {
		CurrentRoom = scene.name;

		if (scene.name == "Menu_Title") {
			if (saveLoaded) {
				saveLoaded = false;
				startingSave = false;
				server.Send(PrepareSaveDataMessage());
			}
			return;
		}

		if (startingSave) {
			startingSave = false;
			saveLoaded = true;
			server.Send(PrepareSaveDataMessage());
		}

		server.Send(PreparePlayerMoveMessage());
	}

	public string PreparePlayerMoveMessage() {
		return JToken.FromObject(new {
			type = "playerMove",
			newRoom = CurrentRoom,
		}).ToString();
	}

	public string PrepareSaveDataMessage() {
		if (!saveLoaded) {
			return JToken.FromObject(new {
				type = "unloadSave",
			}).ToString();
		}

		return JsonConvert.SerializeObject(
			new {
				type = "loadSave",
				data = new {
					//this is more-or-less the normal save file data, but not everything
					playerData = GameManager.instance.playerData,
					PolymorphicModData = new {
						RandomizerMod = JsonConvert.SerializeObject(RandomizerMod.RandomizerMod.RS),
						context = JsonConvert.SerializeObject(RandomizerMod.RandomizerMod.RS.Context)
					},
				},
			},
			Formatting.None, new JsonSerializerSettings {
				ContractResolver = ShouldSerializeContractResolver.Instance,
				TypeNameHandling = TypeNameHandling.Auto,
				Converters = JsonConverterTypes.ConverterTypes,
			}
		);
	}



	public override string GetVersion() {
		return "0.0.2";
	}
}

internal class TangledMapManager : MonoBehaviour {
	public TangledMapViewMod mod;
	public void Start() => StartCoroutine(StartServer());
	public void OnApplicationQuit() => mod?.server.Stop();
	public void OnDisable() => mod?.server.Stop();

	private IEnumerator StartServer() {
		//game crashes if we start server right away
		yield return null;
		yield return null;
		yield return null;

		mod.server = new MapServer((Modding.ILogger)mod);
		mod.server.Start();
		mod.Log("TangledMapViewMod web server started: http://localhost:" + mod.server.port + "/");

	}
}

}
