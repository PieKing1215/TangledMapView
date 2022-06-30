
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Modding;
using Modding.Patches;
using MonoMod.RuntimeDetour;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RandomizerMod;
using UnityEngine;
using UnityEngine.Rendering;
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

namespace TangledMapView
{

    public class TangledMapViewMod : Mod
    {
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

        public Dictionary<string, byte[]> assetCache = new Dictionary<string, byte[]>();

        public TangledMapViewMod() : base("TangledMapView") { }

        public override int LoadPriority()
        {
            return 100;//want randomizer to load before us
        }


        public override void Initialize()
        {
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

            ModHooks.AfterSavegameLoadHook += data =>
            {
                Log("get load");
                saveLoaded = true;
                string saveData = PrepareSaveDataMessage();
                Instance.Log($"saveData= {saveData}");
                server.Send(saveData);
            };

            float lastPosSend = 0.0f;
            ModHooks.HeroUpdateHook += () =>
            {
                if (Time.time - lastPosSend > 0.5)
                {
                    lastPosSend = Time.time;
                    server.Send(PreparePlayerPositionMessage());
                }
            };

            Sprite[] sprites = Resources.FindObjectsOfTypeAll<Sprite>();
            foreach (Sprite s in sprites)
            {
                if (s.name.Equals("Map_Knight_Pin_Compass") || s.name.Equals("pin_bench"))
                {
                    Texture2D tex = s.texture;
                    Texture2D tex2 = SpriteToTexture(s);
                    assetCache.Add(s.name, tex2.EncodeToPNG());
                    //File.WriteAllBytes("E:/projects/hk_mods/assetrip/test.png", tex2.EncodeToPNG());
                }
            }

            On.UIManager.StartNewGame += (orig, self, death, rush) =>
            {
                Log("got StartNewGame");
                startingSave = true;//we will actually push data once a scene loads
                orig(self, death, rush);
            };

            

            //Texture2D t = (Texture2D)AssetD.LoadAssetAtPath("Assets/Textures/texture.jpg", typeof(Texture2D));

            Log("done init");
            //note: ModHooks.Instance.NewGameHook not called, likely because the randomizer mod overrides how a game is started
        }

        public void Update()
        {

        }

        private static void OnGiveItem(int id, string item, string location)
        {
            //orig(action, item, location, geo);
            Instance.Log($"GiveItem hook: {id}, {item}, {location}");

            Instance.server.Send(JToken.FromObject(new
            {
                type = "getItem",
                item,
                location,
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

        private void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            CurrentRoom = scene.name;

            if (scene.name == "Menu_Title")
            {
                if (saveLoaded)
                {
                    saveLoaded = false;
                    startingSave = false;
                    server.Send(PrepareSaveDataMessage());
                }
                return;
            }

            if (startingSave)
            {
                startingSave = false;
                saveLoaded = true;
                server.Send(PrepareSaveDataMessage());
            }

            server.Send(PreparePlayerMoveMessage());
            server.Send(PreparePlayerPositionMessage());
        }

        public string PreparePlayerMoveMessage()
        {
            if (HeroController.SilentInstance != null)
            {
                return JToken.FromObject(new
                {
                    type = "playerMove",
                    newRoom = CurrentRoom,
                    x = HeroController.instance.transform.position.x,
                    y = HeroController.instance.transform.position.y,
                }).ToString();
            }
            else
            {
                return JToken.FromObject(new
                {
                    type = "playerMove",
                    newRoom = CurrentRoom,
                    x = -100000.0,
                    y = -100000.0,
                }).ToString();
            }
        }

        public string PreparePlayerPositionMessage()
        {
            if (HeroController.SilentInstance != null)
            {
                return JToken.FromObject(new
                {
                    type = "playerPos",
                    x = HeroController.instance.transform.position.x,
                    y = HeroController.instance.transform.position.y,
                }).ToString();
            }
            else
            {
                return JToken.FromObject(new
                {
                    type = "playerPos",
                    x = -100000.0,
                    y = -100000.0,
                }).ToString();
            }
        }

        public string PrepareSaveDataMessage()
        {
            if (!saveLoaded)
            {
                return JToken.FromObject(new
                {
                    type = "unloadSave",
                }).ToString();
            }

            return JsonConvert.SerializeObject(
                new
                {
                    type = "loadSave",
                    data = new
                    {
                        //this is more-or-less the normal save file data, but not everything
                        playerData = GameManager.instance.playerData,
                        PolymorphicModData = new
                        {
                            RandomizerMod = JsonConvert.SerializeObject(RandomizerMod.RandomizerMod.RS),
                            context = JsonConvert.SerializeObject(RandomizerMod.RandomizerMod.RS.Context),
                            RandomizerData = new
                            {
                                items = JsonConvert.SerializeObject(typeof(RandomizerMod.RandomizerData.Data).GetField("_items", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null)),
                                locations = JsonConvert.SerializeObject(typeof(RandomizerMod.RandomizerData.Data).GetField("_locations", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null)),
                                transitions = JsonConvert.SerializeObject(typeof(RandomizerMod.RandomizerData.Data).GetField("_transitions", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null)),
                                rooms = JsonConvert.SerializeObject(typeof(RandomizerMod.RandomizerData.Data).GetField("_rooms", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null))
                            }
                        },
                    },
                },
                Formatting.None, new JsonSerializerSettings
                {
                    ContractResolver = ShouldSerializeContractResolver.Instance,
                    TypeNameHandling = TypeNameHandling.Auto,
                    Converters = JsonConverterTypes.ConverterTypes,
                }
            );
        }

        public string PrepareAssetMessage(string name)
        {
            if (assetCache.TryGetValue(name, out byte[] bytes))
            {
                string data = Convert.ToBase64String(bytes);

                return JToken.FromObject(new
                {
                    type = "asset",
                    name,
                    data,
                }).ToString();
            }
            else
            {
                Log("Missing asset for PrepareAssetMessage " + name);
                return null;
            }
        }

        public override string GetVersion()
        {
            return "0.0.2";
        }

        Texture2D SpriteToTexture(Sprite sprite)
        {

            Mesh mesh = BuildSpriteMesh(sprite);

            Log(mesh.bounds);
            
            RenderTexture tmp = RenderTexture.GetTemporary(
                    (int)(mesh.bounds.extents.x * sprite.pixelsPerUnit) * 2,
                    (int)(mesh.bounds.extents.y * sprite.pixelsPerUnit) * 2,
                    0,
                    RenderTextureFormat.Default,
                    RenderTextureReadWrite.Linear);

            Material mat = new Material(Shader.Find("Unlit/Transparent"));
            mat.mainTexture = sprite.texture;

            CommandBuffer commandBuffer = new CommandBuffer();

            commandBuffer.Clear();
            commandBuffer.SetRenderTarget(tmp);
            commandBuffer.ClearRenderTarget(true, true, Color.clear);

            var drawDimensions = new Vector3(tmp.width, tmp.height);
            var drawPosition = Vector3.zero * sprite.pixelsPerUnit;
            var orthoMin = -drawDimensions / 2f + drawPosition;
            var orthoMax = drawDimensions / 2f + drawPosition;
            var projMat = Matrix4x4.Ortho(orthoMin.x, orthoMax.x, orthoMin.y, orthoMax.y, float.MinValue, float.MaxValue);

            drawPosition = new Vector3(mesh.bounds.center.x, -mesh.bounds.center.y, 0.0f) * sprite.pixelsPerUnit;

            Log(mesh.bounds);
            Log(mesh.bounds.center);
            Log(mesh.bounds.center * sprite.pixelsPerUnit);
            Log(drawPosition);
            commandBuffer.SetProjectionMatrix(projMat);

            var drawRotation = Quaternion.identity;
            var drawScale = Vector3.one * sprite.pixelsPerUnit;
            var drawTransform = Matrix4x4.TRS(drawPosition, drawRotation, drawScale);
            commandBuffer.DrawMesh(mesh, drawTransform, mat);

            Graphics.ExecuteCommandBuffer(commandBuffer);

            RenderTexture previous = RenderTexture.active;

            RenderTexture.active = tmp;

            Texture2D readable = new Texture2D((int)tmp.width, (int)tmp.height);

            readable.ReadPixels(new Rect(0, 0, tmp.width, tmp.height), 0, 0);
            readable.Apply();

            RenderTexture.active = previous;
            RenderTexture.ReleaseTemporary(tmp);

            return readable;
        }

        Mesh SpriteToMesh(Sprite sprite)
        {
            Mesh mesh = new Mesh
            {
                vertices = Array.ConvertAll(sprite.vertices, i => (Vector3)i),
                uv = sprite.uv,
                triangles = Array.ConvertAll(sprite.triangles, i => (int)i)
            };

            return mesh;
        }

        private static Mesh BuildSpriteMesh(Sprite sprite)
        {
            var mesh = new Mesh();
            mesh.hideFlags = HideFlags.HideAndDontSave;
            mesh.name = $"{sprite.name} Sprite Mesh";
            mesh.vertices = Array.ConvertAll(sprite.vertices, i => new Vector3(i.x, i.y));
            mesh.uv = sprite.uv;
            mesh.triangles = Array.ConvertAll(sprite.triangles, i => (int)i);
            return mesh;
        }
    }

    internal class TangledMapManager : MonoBehaviour
    {
        public TangledMapViewMod mod;
        public void Start() => StartCoroutine(StartServer());
        public void OnApplicationQuit() => mod?.server.Stop();
        public void OnDisable() => mod?.server.Stop();

        private IEnumerator StartServer()
        {
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

